import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "./accounts.ts";
import type { AppOptions } from "./app.ts";
import type { OAuthProvider } from "./auth.ts";
import type { Db } from "./db.ts";
import { cookiesFrom, resetDb, testDb } from "./testing.ts";

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
const { getAnthropicKey } = await import("./accounts.ts");
const { AiError } = await import("./ai.ts");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

// oxlint-disable-next-line no-explicit-any
const json = (res: Response): Promise<any> => res.json();
const SECRET = "test-secret";

let db: Db;
beforeAll(async () => void (db = await testDb()));
afterAll(() => db.close());
beforeEach(async () => {
  await resetDb(db);
  for (const f of [...Object.values(ai), ...Object.values(images)]) f.mockReset();
});

const fakeClient = { fake: "claude" } as unknown as InstanceType<typeof Anthropic>;
const claude = vi.fn((_key: string) => fakeClient);
const verifyKey = vi.fn(async (_key: string) => {});

function makeApp(over: Partial<AppOptions> = {}) {
  return createApp({ db, secret: SECRET, allowDevLogin: true, claude, verifyKey, ...over });
}

/** Sign in through the dev provider and return headers carrying the session cookie. */
async function signedIn(app: ReturnType<typeof makeApp>, email = "ada@example.com") {
  const res = await app.request(`/api/auth/dev?email=${encodeURIComponent(email)}`);
  const session = cookiesFrom(res).orator_session.value;
  return { cookie: `orator_session=${session}` };
}

const post = (headers: Record<string, string>, body: unknown, method = "POST") => ({
  method,
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function withKey(app: ReturnType<typeof makeApp>, email = "ada@example.com") {
  const h = await signedIn(app, email);
  await app.request("/api/me/anthropic-key", post(h, { key: "sk-ant-user-key-abcd" }, "PUT"));
  return h;
}

describe("account", () => {
  it("reports no user when signed out, and the user when signed in", async () => {
    const app = makeApp();
    expect(await json(await app.request("/api/me"))).toEqual({ user: null });
    const h = await signedIn(app);
    expect((await json(await app.request("/api/me", { headers: h }))).user).toMatchObject({ email: "ada@example.com", hasAnthropicKey: false });
  });

  it("verifies, stores and removes the user's Anthropic key without echoing it", async () => {
    const app = makeApp();
    const h = await signedIn(app);
    const res = await app.request("/api/me/anthropic-key", post(h, { key: "  sk-ant-user-key-abcd  " }, "PUT"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("sk-ant-user-key");
    expect(JSON.parse(text).user).toMatchObject({ hasAnthropicKey: true, anthropicKeyHint: "abcd" });
    expect(verifyKey).toHaveBeenLastCalledWith("sk-ant-user-key-abcd");

    const del = await app.request("/api/me/anthropic-key", { method: "DELETE", headers: h });
    expect((await json(del)).user.hasAnthropicKey).toBe(false);
  });

  it("refuses empty keys and keys Anthropic rejects", async () => {
    const app = makeApp();
    const h = await signedIn(app);
    expect((await app.request("/api/me/anthropic-key", post(h, { key: " " }, "PUT"))).status).toBe(400);
    verifyKey.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, { error: {} }, "invalid x-api-key", new Headers()));
    const bad = await app.request("/api/me/anthropic-key", post(h, { key: "sk-ant-wrong" }, "PUT"));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatch(/didn't accept that key/);
    expect((await json(await app.request("/api/me", { headers: h }))).user.hasAnthropicKey).toBe(false);
  });

  it("requires sign-in to change the key", async () => {
    const res = await makeApp().request("/api/me/anthropic-key", post({}, { key: "sk-ant-x" }, "PUT"));
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("signed_out");
  });

  it("gives the owner account the server's key on sign-in", async () => {
    const app = makeApp({ owner: { email: "jeff@example.com", serverKey: "sk-ant-server-key-9999" } });
    const owner = await signedIn(app, "jeff@example.com");
    const me = (await json(await app.request("/api/me", { headers: owner }))).user;
    expect(me).toMatchObject({ hasAnthropicKey: true, anthropicKeyHint: "9999" });
    expect(await getAnthropicKey(db, me.id, SECRET)).toBe("sk-ant-server-key-9999");

    const other = await signedIn(app, "someone@example.com");
    expect((await json(await app.request("/api/me", { headers: other }))).user.hasAnthropicKey).toBe(false);
  });
});

describe("AI routes", () => {
  it("require sign-in", async () => {
    const res = await makeApp().request("/api/ai/helper", post({}, {}));
    expect(res.status).toBe(401);
    expect(ai.beatHelper).not.toHaveBeenCalled();
  });

  it("explain how to add a key when the user has none", async () => {
    const app = makeApp();
    const res = await app.request("/api/ai/helper", post(await signedIn(app), {}));
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: "no_key", error: expect.stringMatching(/Account settings/) });
  });

  it("run each helper on the signed-in user's own key", async () => {
    const app = makeApp();
    const h = await withKey(app);
    const cases = [
      ["/api/ai/helper", ai.beatHelper],
      ["/api/ai/points", ai.beatPoints],
      ["/api/ai/sections", ai.suggestSections],
      ["/api/ai/coach", ai.storyCoach],
      ["/api/ai/visual-ideas", ai.visualIdeas],
    ] as const;
    for (const [path, fn] of cases) {
      fn.mockResolvedValue({ from: path });
      const res = await app.request(path, post(h, { hello: path }));
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ from: path });
      expect(fn).toHaveBeenCalledWith(fakeClient, { hello: path });
    }
    expect(claude).toHaveBeenLastCalledWith("sk-ant-user-key-abcd");
  });

  it("keep users' keys separate", async () => {
    const app = makeApp();
    const ada = await withKey(app, "ada@example.com");
    const bob = await signedIn(app, "bob@example.com");
    await app.request("/api/me/anthropic-key", post(bob, { key: "sk-ant-bobs-key-0000" }, "PUT"));
    ai.beatHelper.mockResolvedValue({});
    await app.request("/api/ai/helper", post(bob, {}));
    expect(claude).toHaveBeenLastCalledWith("sk-ant-bobs-key-0000");
    await app.request("/api/ai/helper", post(ada, {}));
    expect(claude).toHaveBeenLastCalledWith("sk-ant-user-key-abcd");
  });

  it("list lenses without sign-in", async () => {
    expect(Object.keys(await json(await makeApp().request("/api/ai/lenses")))).toContain("and-but-therefore");
  });

  it("map errors to HTTP statuses, never confusing a bad key with being signed out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp();
    const h = await withKey(app);
    ai.beatHelper.mockRejectedValueOnce(new AiError("declined", 422));
    expect((await app.request("/api/ai/helper", post(h, {}))).status).toBe(422);

    ai.beatHelper.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, { error: {} }, "bad key", new Headers()));
    const auth = await app.request("/api/ai/helper", post(h, {}));
    expect(auth.status).toBe(400);
    expect(await json(auth)).toMatchObject({ code: "key_rejected", error: expect.stringMatching(/Account settings/) });

    ai.beatHelper.mockRejectedValueOnce(new Anthropic.RateLimitError(429, { error: {} }, "slow down", new Headers()));
    expect((await app.request("/api/ai/helper", post(h, {}))).status).toBe(429);

    ai.beatHelper.mockRejectedValueOnce(new Error("boom"));
    expect((await app.request("/api/ai/helper", post(h, {}))).status).toBe(500);
  });

  it("reject oversized requests", async () => {
    const app = makeApp();
    const res = await app.request("/api/ai/helper", post(await withKey(app), { selection: "x".repeat(3 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });
});

describe("image routes", () => {
  it("require sign-in", async () => {
    const app = makeApp();
    expect((await app.request("/api/images/search?q=map")).status).toBe(401);
    expect((await app.request("/api/images/fetch?url=x")).status).toBe(401);
  });

  it("search, short-circuiting empty queries", async () => {
    const app = makeApp();
    const h = await signedIn(app);
    expect(await json(await app.request("/api/images/search?q=%20", { headers: h }))).toEqual({ results: [], errors: [] });
    expect(images.searchImages).not.toHaveBeenCalled();
    images.searchImages.mockResolvedValue({ results: [{ id: "1" }], errors: [] });
    await app.request("/api/images/search?q=map&providers=wikimedia", { headers: h });
    expect(images.searchImages).toHaveBeenCalledWith("map", ["wikimedia"]);
  });

  it("proxy image bytes and report failures", async () => {
    const app = makeApp();
    const h = await signedIn(app);
    expect((await app.request("/api/images/fetch", { headers: h })).status).toBe(400);
    images.fetchImageBytes.mockResolvedValueOnce({ type: "image/png", buf: new Uint8Array([1, 2, 3]).buffer });
    const res = await app.request("/api/images/fetch?url=https%3A%2F%2Fx%2Fa.png", { headers: h });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    images.fetchImageBytes.mockRejectedValueOnce(new Error("URL not allowed"));
    const bad = await app.request("/api/images/fetch?url=http%3A%2F%2Flocalhost", { headers: h });
    expect(bad.status).toBe(502);
    expect((await json(bad)).error).toBe("URL not allowed");
  });
});

describe("sign-in", () => {
  const profile: ProviderProfile = { provider: "google", subject: "g-1", email: "ada@example.com", emailVerified: true, name: "Ada", avatarUrl: null };
  const fakeProvider = (p: ProviderProfile = profile) => ({
    authorizeUrl: vi.fn((redirectUri: string, state: string) => new URL(`https://idp.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`)),
    exchange: vi.fn(async () => p),
  }) satisfies OAuthProvider;

  async function startFlow(app: ReturnType<typeof makeApp>, name: string, headers: Record<string, string> = {}) {
    const res = await app.request(`/api/auth/${name}`, { headers });
    expect(res.status).toBe(302);
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    const flow = cookiesFrom(res)[`orator_${name}_flow`];
    return { state, flow, cookie: `orator_${name}_flow=${flow.value}` };
  }

  it("lists the configured providers", async () => {
    const app = makeApp({ providers: { google: fakeProvider() }, allowDevLogin: false });
    expect(await json(await app.request("/api/auth/providers"))).toEqual({ google: true, apple: false, dev: false });
  });

  it("completes the Google flow and starts a session", async () => {
    const google = fakeProvider();
    const app = makeApp({ providers: { google } });
    const { state, flow, cookie } = await startFlow(app, "google");
    expect(flow.attrs).toMatch(/HttpOnly/);
    expect(flow.attrs).toMatch(/SameSite=Lax/);
    expect(google.authorizeUrl).toHaveBeenCalledWith("http://localhost/api/auth/google/callback", state, expect.any(String));

    const done = await app.request(`/api/auth/google/callback?code=abc&state=${state}`, { headers: { cookie } });
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/");
    const verifier = flow.value.split(".")[1];
    expect(google.exchange).toHaveBeenCalledWith("http://localhost/api/auth/google/callback", "abc", verifier, { user: undefined });
    const session = cookiesFrom(done).orator_session;
    expect(session.attrs).toMatch(/HttpOnly/);
    expect(session.attrs).toMatch(/SameSite=Lax/);
    const me = await json(await app.request("/api/me", { headers: { cookie: `orator_session=${session.value}` } }));
    expect(me.user).toMatchObject({ email: "ada@example.com", name: "Ada" });
  });

  it("rejects a callback whose state doesn't match", async () => {
    const google = fakeProvider();
    const app = makeApp({ providers: { google } });
    const { cookie } = await startFlow(app, "google");
    const res = await app.request("/api/auth/google/callback?code=abc&state=forged", { headers: { cookie } });
    expect(res.headers.get("location")).toMatch(/^\/\?auth_error=/);
    expect(google.exchange).not.toHaveBeenCalled();
    expect(cookiesFrom(res).orator_session).toBeUndefined();
  });

  it("reports cancellation and provider failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const google = fakeProvider();
    const app = makeApp({ providers: { google } });
    const cancelled = await app.request("/api/auth/google/callback?error=access_denied");
    expect(decodeURIComponent(cancelled.headers.get("location")!)).toMatch(/cancelled/);

    google.exchange.mockRejectedValueOnce(new Error("bad code"));
    const { state, cookie } = await startFlow(app, "google");
    const failed = await app.request(`/api/auth/google/callback?code=abc&state=${state}`, { headers: { cookie } });
    expect(decodeURIComponent(failed.headers.get("location")!)).toMatch(/Couldn't complete sign-in/);
  });

  it("handles Apple's cross-site form POST callback", async () => {
    const apple = fakeProvider({ ...profile, provider: "apple", subject: "a-1" });
    const app = makeApp({ providers: { apple } });
    const { state, flow, cookie } = await startFlow(app, "apple", { "x-forwarded-proto": "https" });
    expect(flow.attrs).toMatch(/SameSite=None/);
    expect(flow.attrs).toMatch(/Secure/);

    const user = JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" } });
    const res = await app.request("/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie, origin: "https://appleid.apple.com", "content-type": "application/x-www-form-urlencoded", "x-forwarded-proto": "https" },
      body: new URLSearchParams({ code: "xyz", state, user }).toString(),
    });
    expect(res.headers.get("location")).toBe("/");
    expect(apple.exchange).toHaveBeenCalledWith("https://localhost/api/auth/apple/callback", "xyz", expect.anything(), { user });
    expect(cookiesFrom(res).orator_session.attrs).toMatch(/Secure/);
  });

  it("builds callback URLs from the configured public URL", async () => {
    const google = fakeProvider();
    const app = makeApp({ providers: { google }, publicUrl: "https://www.orator-ai.com/" });
    await startFlow(app, "google");
    expect(google.authorizeUrl).toHaveBeenCalledWith("https://www.orator-ai.com/api/auth/google/callback", expect.any(String), expect.any(String));
  });

  it("signs in as the configured local developer by default", async () => {
    const app = makeApp({ devLoginEmail: "Jeff@Example.com" });
    const res = await app.request("/api/auth/dev");
    const cookie = `orator_session=${cookiesFrom(res).orator_session.value}`;
    expect((await json(await app.request("/api/me", { headers: { cookie } }))).user.email).toBe("jeff@example.com");
  });

  it("only offers dev sign-in when enabled", async () => {
    expect((await makeApp({ allowDevLogin: false }).request("/api/auth/dev?email=x@y.z")).status).toBe(404);
  });

  it("signs out", async () => {
    const app = makeApp();
    const h = await signedIn(app);
    const res = await app.request("/api/auth/logout", { method: "POST", headers: h });
    expect(cookiesFrom(res).orator_session.value).toBe("");
    expect(await json(await app.request("/api/me", { headers: h }))).toEqual({ user: null });
  });
});

describe("cross-site protection", () => {
  it("blocks state-changing requests from other origins", async () => {
    const app = makeApp();
    const h = await signedIn(app);
    const evil = await app.request("/api/me/anthropic-key", { method: "DELETE", headers: { ...h, origin: "https://evil.example", host: "orator.example" } });
    expect(evil.status).toBe(403);
    const same = await app.request("/api/me/anthropic-key", { method: "DELETE", headers: { ...h, origin: "https://orator.example", host: "orator.example" } });
    expect(same.status).toBe(200);
  });
});

describe("production options", () => {
  const root = mkdtempSync(join(tmpdir(), "orator-dist-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Orator</title>");
  writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");

  it("serves the built app, with an SPA fallback and long-lived caching for hashed assets", async () => {
    const app = makeApp({ staticRoot: root });
    const index = await app.request("/");
    expect(await index.text()).toContain("<title>Orator</title>");
    expect(index.headers.get("cache-control")).toBeNull();
    const asset = await app.request("/assets/app-abc123.js");
    expect(asset.headers.get("cache-control")).toMatch(/immutable/);
    expect(await (await app.request("/some/deep/link")).text()).toContain("<title>Orator</title>");
    expect((await app.request("/api/nope")).status).toBe(404);
  });

  it("redirects plain HTTP to HTTPS when forced", async () => {
    const app = makeApp({ forceHttps: true });
    const res = await app.request("http://orator.example/api/health", { headers: { "x-forwarded-proto": "http" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://orator.example/api/health");
    expect((await app.request("http://orator.example/api/health", { headers: { "x-forwarded-proto": "https" } })).status).toBe(200);
  });

  it("sets security headers", async () => {
    const res = await makeApp().request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
