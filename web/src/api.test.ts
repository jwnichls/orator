import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, SIGNED_OUT_EVENT } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("POSTs JSON and returns the parsed body", async () => {
    const fetchMock = vi.fn(async () => Response.json({ replacement: "r", rationale: "y" }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { action: "tidy", selection: "s", before: "", after: "" };
    expect(await api.helper(body)).toEqual({ replacement: "r", rationale: "y" });
    expect(fetchMock).toHaveBeenCalledWith("/api/ai/helper", expect.objectContaining({ method: "POST", body: JSON.stringify(body) }));
  });

  it("throws the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "AI is offline: set ANTHROPIC_API_KEY" }, { status: 503 })));
    await expect(api.coach({ beats: [], lens: "none" })).rejects.toThrow("AI is offline: set ANTHROPIC_API_KEY");
  });

  it("falls back to the status when the error body isn't JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad gateway", { status: 502 })));
    await expect(api.points({ beats: [], context: [] })).rejects.toThrow("Request failed (502)");
  });

  it("encodes image search queries", async () => {
    const fetchMock = vi.fn(async () => Response.json({ results: [], errors: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.searchImages("snow & cholera");
    expect(fetchMock).toHaveBeenCalledWith("/api/images/search?q=snow%20%26%20cholera");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(api.searchImages("x")).rejects.toThrow("Request failed (500)");
  });

  it("exposes error codes and announces when the session is gone", async () => {
    const onSignedOut = vi.fn();
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Please sign in.", code: "signed_out" }, { status: 401 })));
    const err = await api.helper({ action: "tidy", selection: "", before: "", after: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "signed_out" });
    expect(onSignedOut).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Add your key", code: "no_key" }, { status: 403 })));
    expect(await api.points({ beats: [], context: [] }).catch((e) => e.code)).toBe("no_key");
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  });

  it("reads and updates the account", async () => {
    const user = { id: "u", hasAnthropicKey: true };
    const fetchMock = vi.fn(async () => Response.json({ user }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.me()).toEqual(user);
    expect(await api.setAnthropicKey("sk-ant-x")).toEqual(user);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/me/anthropic-key", expect.objectContaining({ method: "PUT", body: JSON.stringify({ key: "sk-ant-x" }) }));
    await api.removeAnthropicKey();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/me/anthropic-key", expect.objectContaining({ method: "DELETE" }));
  });
});
