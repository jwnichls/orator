import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

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
    await expect(api.searchImages("x")).rejects.toThrow("Search failed (500)");
  });
});
