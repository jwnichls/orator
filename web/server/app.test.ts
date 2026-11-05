import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({
  beatHelper: vi.fn(),
  beatPoints: vi.fn(),
  suggestSections: vi.fn(),
  storyCoach: vi.fn(),
  visualIdeas: vi.fn(),
}));
const images = vi.hoisted(() => ({ searchImages: vi.fn(), fetchImageBytes: vi.fn() }));

vi.mock("./ai.ts", async (orig) => ({ ...(await orig<typeof import("./ai.ts")>()), ...ai }));
vi.mock("./images.ts", () => images);

const { createApp } = await import("./app.ts");
const { AiError } = await import("./ai.ts");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

// oxlint-disable-next-line no-explicit-any
const json = (res: Response): Promise<any> => res.json();
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as const;

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  for (const f of [...Object.values(ai), ...Object.values(images)]) f.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("API", () => {
  const app = createApp();

  it("reports health and whether AI is configured", async () => {
    expect(await json(await app.request("/api/health"))).toEqual({ ok: true, ai: true });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await json(await app.request("/api/health"))).toEqual({ ok: true, ai: false });
  });

  it("routes each AI endpoint to its helper", async () => {
    const cases = [
      ["/api/ai/helper", ai.beatHelper],
      ["/api/ai/points", ai.beatPoints],
      ["/api/ai/sections", ai.suggestSections],
      ["/api/ai/coach", ai.storyCoach],
      ["/api/ai/visual-ideas", ai.visualIdeas],
    ] as const;
    for (const [path, fn] of cases) {
      fn.mockResolvedValue({ from: path });
      const res = await app.request(path, post({ hello: path }));
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ from: path });
      expect(fn).toHaveBeenCalledWith({ hello: path });
    }
  });

  it("lists lenses", async () => {
    expect(Object.keys(await json(await app.request("/api/ai/lenses")))).toContain("and-but-therefore");
  });

  it("returns a clear 503 when no API key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await app.request("/api/ai/helper", post({}));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatch(/ANTHROPIC_API_KEY/);
    expect(ai.beatHelper).not.toHaveBeenCalled();
  });

  it("maps errors to HTTP statuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ai.beatHelper.mockRejectedValueOnce(new AiError("declined", 422));
    expect((await app.request("/api/ai/helper", post({}))).status).toBe(422);

    ai.beatHelper.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, { error: {} }, "bad key", new Headers()));
    const auth = await app.request("/api/ai/helper", post({}));
    expect(auth.status).toBe(401);
    expect((await json(auth)).error).toMatch(/invalid/);

    ai.beatHelper.mockRejectedValueOnce(new Anthropic.RateLimitError(429, { error: {} }, "slow down", new Headers()));
    expect((await app.request("/api/ai/helper", post({}))).status).toBe(429);

    ai.beatHelper.mockRejectedValueOnce(new Error("boom"));
    expect((await app.request("/api/ai/helper", post({}))).status).toBe(500);
  });

  it("rejects oversized AI requests", async () => {
    const res = await app.request("/api/ai/helper", post({ selection: "x".repeat(3 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("searches images, short-circuiting empty queries", async () => {
    expect(await json(await app.request("/api/images/search?q=%20"))).toEqual({ results: [], errors: [] });
    expect(images.searchImages).not.toHaveBeenCalled();
    images.searchImages.mockResolvedValue({ results: [{ id: "1" }], errors: [] });
    await app.request("/api/images/search?q=map&providers=wikimedia");
    expect(images.searchImages).toHaveBeenCalledWith("map", ["wikimedia"]);
  });

  it("proxies image bytes and reports failures", async () => {
    expect((await app.request("/api/images/fetch")).status).toBe(400);
    images.fetchImageBytes.mockResolvedValueOnce({ type: "image/png", buf: new Uint8Array([1, 2, 3]).buffer });
    const res = await app.request("/api/images/fetch?url=https%3A%2F%2Fx%2Fa.png");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    images.fetchImageBytes.mockRejectedValueOnce(new Error("URL not allowed"));
    const bad = await app.request("/api/images/fetch?url=http%3A%2F%2Flocalhost");
    expect(bad.status).toBe(502);
    expect((await json(bad)).error).toBe("URL not allowed");
  });

  it("404s unknown API routes as JSON", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Not found" });
  });
});

describe("production options", () => {
  const root = mkdtempSync(join(tmpdir(), "orator-dist-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Orator</title>");
  writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");

  it("serves the built app, with an SPA fallback and long-lived caching for hashed assets", async () => {
    const app = createApp({ staticRoot: root });
    const index = await app.request("/");
    expect(await index.text()).toContain("<title>Orator</title>");
    expect(index.headers.get("cache-control")).toBeNull();
    const asset = await app.request("/assets/app-abc123.js");
    expect(asset.headers.get("cache-control")).toMatch(/immutable/);
    expect(await (await app.request("/some/deep/link")).text()).toContain("<title>Orator</title>");
    expect((await app.request("/api/nope")).status).toBe(404);
  });

  it("requires basic auth everywhere except the health check", async () => {
    const app = createApp({ staticRoot: root, auth: { username: "u", password: "p" } });
    expect((await app.request("/")).status).toBe(401);
    expect((await app.request("/api/ai/lenses")).status).toBe(401);
    expect((await app.request("/api/health")).status).toBe(200);
    const authed = { headers: { authorization: `Basic ${btoa("u:p")}` } };
    expect((await app.request("/", authed)).status).toBe(200);
    expect((await app.request("/api/ai/lenses", authed)).status).toBe(200);
    expect((await app.request("/", { headers: { authorization: `Basic ${btoa("u:wrong")}` } })).status).toBe(401);
  });

  it("redirects plain HTTP to HTTPS when forced", async () => {
    const app = createApp({ forceHttps: true });
    const res = await app.request("http://orator.example/api/health", { headers: { "x-forwarded-proto": "http" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://orator.example/api/health");
    expect((await app.request("http://orator.example/api/health", { headers: { "x-forwarded-proto": "https" } })).status).toBe(200);
  });

  it("sets security headers", async () => {
    const res = await createApp().request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
