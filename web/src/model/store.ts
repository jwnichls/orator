import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { nanoid } from "nanoid";
import { SCHEMA_VERSION, type Asset, type AssetSource, type Talk } from "./types";

interface OratorDB extends DBSchema {
  talks: { key: string; value: Talk };
  assets: { key: string; value: Asset };
  blobs: { key: string; value: Blob };
}

const open = (name: string) =>
  openDB<OratorDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore("talks", { keyPath: "id" });
      db.createObjectStore("assets", { keyPath: "id" });
      db.createObjectStore("blobs");
    },
  });

/** Talks saved before accounts existed, in one browser-wide database. */
const LEGACY_DB = "orator";
const LEGACY_CLAIMED = "orator:legacy-claimed-by";

let current: { userId: string; db: Promise<IDBPDatabase<OratorDB>> } | null = null;

/**
 * Point storage at the signed-in user's own database, so people sharing a browser never see each other's talks.
 * The first account to sign in on a browser gets a copy of any talks saved there before accounts existed.
 */
export function setStoreUser(userId: string) {
  if (current?.userId === userId) return current.db;
  urlCache.clear();
  current = { userId, db: open(`orator-${userId}`).then((db) => adoptLegacyTalks(db, userId).then(() => db)) };
  return current.db;
}

async function adoptLegacyTalks(db: IDBPDatabase<OratorDB>, userId: string) {
  if (localStorage.getItem(LEGACY_CLAIMED)) return;
  const exists = (await indexedDB.databases?.())?.some((d) => d.name === LEGACY_DB) ?? false;
  if (!exists) return;
  const legacy = await open(LEGACY_DB);
  try {
    const [talks, assets, blobKeys] = await Promise.all([legacy.getAll("talks"), legacy.getAll("assets"), legacy.getAllKeys("blobs")]);
    const blobs = await Promise.all(blobKeys.map(async (k) => [k, (await legacy.get("blobs", k))!] as const));
    const tx = db.transaction(["talks", "assets", "blobs"], "readwrite");
    await Promise.all([
      ...talks.map((t) => tx.objectStore("talks").put(t)),
      ...assets.map((a) => tx.objectStore("assets").put(a)),
      ...blobs.map(([k, b]) => tx.objectStore("blobs").put(b, k)),
      tx.done,
    ]);
    localStorage.setItem(LEGACY_CLAIMED, userId);
  } finally {
    legacy.close(); // left in place, not deleted, so nothing is lost if the copy is ever wrong
  }
}

const database = () => {
  if (!current) throw new Error("Storage used before sign-in");
  return current.db;
};

export async function listTalks() {
  const talks = await (await database()).getAll("talks");
  return talks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getTalk(id: string) {
  return (await database()).get("talks", id);
}

export async function saveTalk(talk: Talk) {
  await (await database()).put("talks", talk);
}

export async function deleteTalk(id: string) {
  await (await database()).delete("talks", id);
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
  const db = await database();
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
  return (await database()).get("assets", id);
}

export async function getAssetBlob(id: string) {
  return (await database()).get("blobs", id);
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
