import type { JSONContent } from "@tiptap/react";

export const SCHEMA_VERSION = 1;

/**
 * A talk in the Write + Gather stages. The script lives in `doc` (TipTap/ProseMirror JSON):
 *  - paragraph nodes are beats (attrs.id stable, attrs.kind "main" | "aside")
 *  - heading nodes (level 2) are optional section breaks (attrs.id stable)
 *  - text spans carry `clip` marks (attrs.clipId) anchoring gathered content to the script
 */
export interface Talk {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  doc: JSONContent;
  clips: Record<string, Clip>;
  /** Reverse-outline points keyed by beat id; `hash` is of the beat text the point was generated from. */
  points: Record<string, BeatPoint>;
}

export interface Clip {
  id: string;
  assetId: string;
  caption?: string;
  note?: string;
  createdAt: number;
}

export interface BeatPoint {
  text: string;
  hash: string;
}

export interface AssetSource {
  provider: "openverse" | "wikimedia" | "upload";
  url?: string;
  pageUrl?: string;
  title?: string;
  creator?: string;
  license?: string;
  licenseUrl?: string;
}

/** Asset metadata. Bytes are stored separately, keyed by the same id (sha256 of the bytes). */
export interface Asset {
  id: string;
  kind: "image";
  mime: string;
  size: number;
  width: number;
  height: number;
  source: AssetSource;
  createdAt: number;
}

export interface Beat {
  id: string;
  text: string;
  kind: "main" | "aside";
  sectionId?: string;
  sectionTitle?: string;
  clipIds: string[];
}

export interface Section {
  id: string;
  title: string;
  beatIds: string[];
}
