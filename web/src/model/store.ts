import { openDB, type DBSchema } from "idb";
import { nanoid } from "nanoid";
import { SCHEMA_VERSION, type Asset, type AssetSource, type Talk } from "./types";

interface OratorDB extends DBSchema {
  talks: { key: string; value: Talk };
  assets: { key: string; value: Asset };
  blobs: { key: string; value: Blob };
}

const dbPromise = openDB<OratorDB>("orator", 1, {
  upgrade(db) {
    db.createObjectStore("talks", { keyPath: "id" });
    db.createObjectStore("assets", { keyPath: "id" });
    db.createObjectStore("blobs");
  },
});

export async function listTalks() {
  const talks = await (await dbPromise).getAll("talks");
  return talks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getTalk(id: string) {
  return (await dbPromise).get("talks", id);
}

export async function saveTalk(talk: Talk) {
  await (await dbPromise).put("talks", talk);
}

export async function deleteTalk(id: string) {
  await (await dbPromise).delete("talks", id);
}

export function newTalk(title = "Untitled talk"): Talk {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: nanoid(),
    title,
    createdAt: now,
    updatedAt: now,
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    clips: {},
    points: {},
  };
}

// ---- Assets: stored as bytes so talks work fully offline ----

export async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function imageSize(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

export async function putAssetBlob(blob: Blob, source: AssetSource): Promise<Asset> {
  const db = await dbPromise;
  const id = await sha256Hex(await blob.arrayBuffer());
  const existing = await db.get("assets", id);
  if (existing) return existing;
  const { width, height } = await imageSize(blob);
  const asset: Asset = { id, kind: "image", mime: blob.type, size: blob.size, width, height, source, createdAt: Date.now() };
  const tx = db.transaction(["assets", "blobs"], "readwrite");
  await Promise.all([tx.objectStore("assets").put(asset), tx.objectStore("blobs").put(blob, id), tx.done]);
  return asset;
}

/** Download a remote image (via the server proxy) and store its bytes locally. */
export async function importRemoteImage(url: string, source: AssetSource) {
  const res = await fetch(`/api/images/fetch?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Download failed (${res.status})`);
  }
  return putAssetBlob(await res.blob(), source);
}

export async function getAsset(id: string) {
  return (await dbPromise).get("assets", id);
}

export async function getAssetBlob(id: string) {
  return (await dbPromise).get("blobs", id);
}

const urlCache = new Map<string, Promise<string | undefined>>();

/** Object URL for a stored asset (cached for the session). */
export function assetUrl(id: string) {
  let p = urlCache.get(id);
  if (!p) {
    p = getAssetBlob(id).then((b) => (b ? URL.createObjectURL(b) : undefined));
    urlCache.set(id, p);
  }
  return p;
}
