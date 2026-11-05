import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicUrl, fetchImageBytes, isBlockedAddress, searchImages } from "./images.ts";

const publicDns = async () => [{ address: "93.184.215.14" }];

afterEach(() => vi.unstubAllGlobals());

describe("isBlockedAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:7f00:1", "::ffff:127.0.0.1"])(
    "blocks %s",
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::1111"])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  it("allows public http(s) hosts", async () => {
    await expect(assertPublicUrl("https://upload.wikimedia.org/a.jpg", publicDns)).resolves.toBeInstanceOf(URL);
  });

  it.each([
    "file:///etc/passwd",
    "ftp://example.com/x",
    "not a url",
    "http://localhost:8787/api/health",
    "http://printer.local/",
    "http://127.0.0.1/",
    "http://2130706433/", // decimal form of 127.0.0.1
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data",
  ])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url, publicDns)).rejects.toThrow();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    await expect(assertPublicUrl("https://evil.example/x.png", async () => [{ address: "93.184.215.14" }, { address: "10.0.0.5" }])).rejects.toThrow(
      "URL not allowed",
    );
  });

  it("rejects hosts that don't resolve", async () => {
    await expect(assertPublicUrl("https://nowhere.example/", async () => [])).rejects.toThrow("Could not resolve host");
  });
});

describe("fetchImageBytes", () => {
  const image = (bytes = 3, headers: Record<string, string> = {}) =>
    new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png", ...headers } });

  it("returns bytes and content type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => image(4)));
    const { type, buf } = await fetchImageBytes("https://example.com/a.png", publicDns);
    expect(type).toBe("image/png");
    expect(buf.byteLength).toBe(4);
  });

  it("follows redirects to public hosts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/real.png" } }))
      .mockResolvedValueOnce(image());
    vi.stubGlobal("fetch", fetchMock);
    await fetchImageBytes("https://example.com/a.png", publicDns);
    expect(fetchMock.mock.calls[1][0]).toBe("https://example.com/real.png");
  });

  it("refuses a redirect into a private network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })));
    await expect(fetchImageBytes("https://example.com/a.png", publicDns)).rejects.toThrow("URL not allowed");
  });

  it("stops after too many redirects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "/again" } })));
    await expect(fetchImageBytes("https://example.com/a.png", publicDns)).rejects.toThrow("Too many redirects");
  });

  it("rejects non-images, upstream errors and oversized files", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })));
    await expect(fetchImageBytes("https://example.com/a", publicDns)).rejects.toThrow(/Not an image/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(fetchImageBytes("https://example.com/a", publicDns)).rejects.toThrow("Upstream 404");
    vi.stubGlobal("fetch", vi.fn(async () => image(1, { "content-length": String(26 * 1024 * 1024) })));
    await expect(fetchImageBytes("https://example.com/a", publicDns)).rejects.toThrow("Image too large");
  });
});

describe("searchImages", () => {
  const openverseBody = {
    results: [1, 2, 3].map((i) => ({
      id: `ov${i}`,
      title: `OV ${i}`,
      url: `https://ov/${i}.jpg`,
      thumbnail: `https://ov/t${i}.jpg`,
      foreign_landing_url: `https://ov/p${i}`,
      creator: "Ann",
      license: "by-nc",
      license_version: "2.0",
    })),
  };
  const wikimediaBody = {
    query: {
      pages: {
        "20": {
          pageid: 20,
          index: 2,
          title: "File:Second.jpg",
          imageinfo: [{ url: "https://up/orig2.jpg", thumburl: "https://up/thumb/500px-Second.jpg", width: 800, height: 600, extmetadata: {} }],
        },
        "10": {
          pageid: 10,
          index: 1,
          title: "File:Snow-cholera-map.jpg",
          imageinfo: [
            {
              url: "https://up/orig.jpg",
              thumburl: "https://up/thumb/500px-Snow.jpg",
              descriptionurl: "https://commons/File:Snow",
              width: 4000,
              height: 3000,
              extmetadata: { ObjectName: { value: "<b>Snow's map</b>" }, Artist: { value: '<a href="x">John Snow</a>' }, LicenseShortName: { value: "Public domain" } },
            },
          ],
        },
      },
    },
  };

  const respond = (url: string) =>
    url.includes("openverse") ? Response.json(openverseBody) : url.includes("wikimedia") ? Response.json(wikimediaBody) : new Response("", { status: 500 });

  it("interleaves providers and normalizes metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
    const { results, errors } = await searchImages("cholera map", ["openverse", "wikimedia"]);
    expect(errors).toEqual([]);
    expect(results.map((r) => r.id)).toEqual(["ov1", "10", "ov2", "20", "ov3"]);
    expect(results[0].license).toBe("BY-NC 2.0");
    const snow = results[1];
    expect(snow).toMatchObject({ title: "Snow's map", creator: "John Snow", license: "Public domain", pageUrl: "https://commons/File:Snow" });
    // Huge originals are swapped for a 1920px rendition; small ones keep the original.
    expect(snow.url).toBe("https://up/thumb/1920px-Snow.jpg");
    expect(results[3].url).toBe("https://up/orig2.jpg");
    expect(results[3].title).toBe("Second.jpg");
  });

  it("returns the other provider's results when one fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("openverse") ? Promise.reject(new Error("timeout")) : respond(url))),
    );
    const { results, errors } = await searchImages("x", ["openverse", "wikimedia"]);
    expect(results.map((r) => r.provider)).toEqual(["wikimedia", "wikimedia"]);
    expect(errors).toEqual(["Error: timeout"]);
  });

  it("only queries requested providers", async () => {
    const fetchMock = vi.fn(async (url: string) => respond(url));
    vi.stubGlobal("fetch", fetchMock);
    await searchImages("x", ["wikimedia"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
