import JSZip from "jszip";
import { nanoid } from "nanoid";
import { getAsset, getAssetBlob, putAssetBlob, saveTalk } from "./store";
import { SCHEMA_VERSION, type Asset, type Talk } from "./types";

/**
 * `.orator` bundle: a zip containing
 *   manifest.json          { format, schemaVersion, exportedAt }
 *   talk.json              the Talk
 *   assets.json            Asset[] metadata
 *   assets/<sha256>.<ext>  bytes for every asset referenced by the talk
 * Self-contained so the iPad app can present with no network.
 */
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

export function assetFileName(a: Asset) {
  return `assets/${a.id}.${EXT[a.mime] ?? "bin"}`;
}

export async function exportBundle(talk: Talk): Promise<Blob> {
  const zip = new JSZip();
  const assetIds = [...new Set(Object.values(talk.clips).map((c) => c.assetId))];
  const assets: Asset[] = [];
  for (const id of assetIds) {
    const [meta, blob] = await Promise.all([getAsset(id), getAssetBlob(id)]);
    if (!meta || !blob) throw new Error(`Asset ${id} is missing from local storage`);
    assets.push(meta);
    zip.file(assetFileName(meta), await blob.arrayBuffer());
  }
  zip.file("manifest.json", JSON.stringify({ format: "orator", schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString() }, null, 2));
  zip.file("talk.json", JSON.stringify(talk, null, 2));
  zip.file("assets.json", JSON.stringify(assets, null, 2));
  return zip.generateAsync({ type: "blob", mimeType: "application/zip" });
}

export async function importBundle(file: Blob): Promise<Talk> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest = JSON.parse((await zip.file("manifest.json")?.async("string")) ?? "{}");
  if (manifest.format !== "orator") throw new Error("Not an Orator bundle");
  if (manifest.schemaVersion > SCHEMA_VERSION) throw new Error("Bundle is from a newer version of Orator");
  const talk: Talk = JSON.parse((await zip.file("talk.json")!.async("string")));
  const assets: Asset[] = JSON.parse((await zip.file("assets.json")?.async("string")) ?? "[]");
  for (const meta of assets) {
    const entry = zip.file(assetFileName(meta));
    if (!entry) throw new Error(`Bundle missing ${assetFileName(meta)}`);
    const bytes = await entry.async("arraybuffer");
    await putAssetBlob(new Blob([bytes], { type: meta.mime }), meta.source);
  }
  // Import as a copy so it never clobbers a local talk with the same id.
  const imported: Talk = { ...talk, id: nanoid(), updatedAt: Date.now() };
  await saveTalk(imported);
  return imported;
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
