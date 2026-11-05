import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { doc, p } from "../../test/editor";
import { assetFileName, exportBundle, importBundle } from "./bundle";
import { assetUrl, deleteTalk, getAsset, getAssetBlob, getTalk, importRemoteImage, listTalks, newTalk, putAssetBlob, saveTalk, sha256Hex } from "./store";
import type { Talk } from "./types";

// Test "images" are bytes spelling their size, which the setup's createImageBitmap stub reads back.
const png = (size: string) => new Blob([size], { type: "image/png" });

describe("store", () => {
  it("saves, lists newest-first, and deletes talks", async () => {
    const a = { ...newTalk("A"), updatedAt: 1 };
    const b = { ...newTalk("B"), updatedAt: 2 };
    await saveTalk(a);
    await saveTalk(b);
    const titles = (await listTalks()).map((t) => t.title);
    expect(titles.indexOf("B")).toBeLessThan(titles.indexOf("A"));
    await deleteTalk(a.id);
    expect(await getTalk(a.id)).toBeUndefined();
  });

  it("starts new talks as a single empty paragraph", () => {
    const t = newTalk();
    expect(t.title).toBe("Untitled talk");
    expect(t.doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(t.schemaVersion).toBe(1);
  });

  it("stores assets content-addressed by SHA-256, with measured size, deduping repeats", async () => {
    const blob = png("640x480");
    const asset = await putAssetBlob(blob, { provider: "upload", title: "x.png" });
    expect(asset.id).toBe(await sha256Hex(await blob.arrayBuffer()));
    expect(asset).toMatchObject({ kind: "image", mime: "image/png", width: 640, height: 480, size: blob.size });
    expect(await (await getAssetBlob(asset.id))!.text()).toBe("640x480");
    const again = await putAssetBlob(png("640x480"), { provider: "openverse" });
    expect(again).toEqual(asset); // first source wins
  });

  it("downloads remote images through the server proxy", async () => {
    const fetchMock = vi.fn(async () => new Response(png("10x20")));
    vi.stubGlobal("fetch", fetchMock);
    const asset = await importRemoteImage("https://up/a b.png", { provider: "wikimedia", license: "CC0" });
    expect(fetchMock).toHaveBeenCalledWith("/api/images/fetch?url=https%3A%2F%2Fup%2Fa%20b.png");
    expect(asset).toMatchObject({ width: 10, height: 20, source: { provider: "wikimedia", license: "CC0" } });

    fetchMock.mockResolvedValueOnce(Response.json({ error: "URL not allowed" }, { status: 502 }));
    await expect(importRemoteImage("http://localhost/", { provider: "wikimedia" })).rejects.toThrow("URL not allowed");
    vi.unstubAllGlobals();
  });

  it("caches object URLs per asset", async () => {
    const asset = await putAssetBlob(png("1x1"), { provider: "upload" });
    const u1 = await assetUrl(asset.id);
    expect(u1).toMatch(/^blob:/);
    expect(await assetUrl(asset.id)).toBe(u1);
    expect(await assetUrl("missing")).toBeUndefined();
  });
});

describe(".orator bundle", () => {
  async function talkWithImages(): Promise<Talk> {
    const a = await putAssetBlob(png("1920x1080"), { provider: "wikimedia", title: "Snow's map", license: "Public domain" });
    const b = await putAssetBlob(png("800x600"), { provider: "upload" });
    const talk: Talk = {
      ...newTalk("Ghost Map"),
      doc: doc(p("b1", "The ", { text: "Broad Street", clip: ["c1", "c2"] }, " pump.")),
      clips: {
        c1: { id: "c1", assetId: a.id, caption: "Snow's map", createdAt: 1 },
        c2: { id: "c2", assetId: b.id, createdAt: 2 },
        c3: { id: "c3", assetId: a.id, createdAt: 3 }, // same asset twice: stored once
      },
      points: { b1: { text: "The pump", hash: "h" } },
    };
    await saveTalk(talk);
    return talk;
  }

  it("contains the manifest, talk, asset metadata and every asset's bytes", async () => {
    const talk = await talkWithImages();
    const zip = await JSZip.loadAsync(await exportBundle(talk));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ format: "orator", schemaVersion: 1 });
    expect(JSON.parse(await zip.file("talk.json")!.async("string"))).toEqual(talk);
    const assets = JSON.parse(await zip.file("assets.json")!.async("string"));
    expect(assets).toHaveLength(2);
    for (const a of assets) {
      expect(a.id).toBe(await sha256Hex(await zip.file(assetFileName(a))!.async("arraybuffer")));
    }
    expect(assetFileName(assets[0])).toMatch(/^assets\/[0-9a-f]{64}\.png$/);
  });

  it("imports as a copy whose clips resolve to locally stored assets", async () => {
    const talk = await talkWithImages();
    const bundle = await exportBundle(talk);
    const imported = await importBundle(bundle);
    expect(imported.id).not.toBe(talk.id);
    expect(imported.doc).toEqual(talk.doc);
    expect(imported.clips).toEqual(talk.clips);
    expect(await getTalk(imported.id)).toEqual(imported);
    for (const clip of Object.values(imported.clips)) {
      expect(await getAsset(clip.assetId)).toBeDefined();
      expect(await getAssetBlob(clip.assetId)).toBeDefined();
    }
  });

  it("fails export when an asset's bytes are missing", async () => {
    const talk = { ...newTalk(), clips: { c: { id: "c", assetId: "nope", createdAt: 0 } } };
    await expect(exportBundle(talk)).rejects.toThrow(/missing from local storage/);
  });

  it("rejects files that aren't Orator bundles, newer versions, or missing assets", async () => {
    const zip = (files: Record<string, string>) => {
      const z = new JSZip();
      for (const [k, v] of Object.entries(files)) z.file(k, v);
      return z.generateAsync({ type: "blob" });
    };
    await expect(importBundle(await zip({ "readme.txt": "hi" }))).rejects.toThrow("Not an Orator bundle");
    await expect(importBundle(await zip({ "manifest.json": JSON.stringify({ format: "orator", schemaVersion: 99 }) }))).rejects.toThrow(/newer version/);
    const meta = [{ id: "a".repeat(64), mime: "image/png", source: { provider: "upload" } }];
    await expect(
      importBundle(
        await zip({ "manifest.json": JSON.stringify({ format: "orator", schemaVersion: 1 }), "talk.json": JSON.stringify(newTalk()), "assets.json": JSON.stringify(meta) }),
      ),
    ).rejects.toThrow(/Bundle missing assets\//);
  });
});
