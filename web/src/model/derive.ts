import type { JSONContent } from "@tiptap/react";
import type { Beat, Section } from "./types";

function textOf(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(textOf).join("");
}

function clipIdsOf(node: JSONContent, out: Set<string>) {
  for (const m of node.marks ?? []) if (m.type === "clip" && m.attrs?.clipId) out.add(m.attrs.clipId);
  for (const c of node.content ?? []) clipIdsOf(c, out);
  return out;
}

/** Flatten the editor doc into beats and (optional) sections. Beats before the first heading are unsectioned. */
export function deriveStructure(doc: JSONContent) {
  const beats: Beat[] = [];
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const node of doc.content ?? []) {
    const id = node.attrs?.id as string | undefined;
    if (!id) continue;
    if (node.type === "heading") {
      current = { id, title: textOf(node).trim() || "Untitled section", beatIds: [] };
      sections.push(current);
    } else if (node.type === "paragraph") {
      const text = textOf(node);
      if (!text.trim()) continue;
      beats.push({
        id,
        text,
        kind: node.attrs?.kind === "aside" ? "aside" : "main",
        sectionId: current?.id,
        sectionTitle: current?.title,
        clipIds: [...clipIdsOf(node, new Set())],
      });
      current?.beatIds.push(id);
    }
  }
  return { beats, sections };
}

/** Map clipId -> the quoted script text it is anchored to (concatenated across its mark ranges). */
export function clipQuotes(doc: JSONContent) {
  const quotes = new Map<string, { beatId: string; quote: string }>();
  for (const block of doc.content ?? []) {
    const beatId = block.attrs?.id;
    const walk = (n: JSONContent) => {
      if (n.type === "text") {
        for (const m of n.marks ?? []) {
          if (m.type !== "clip") continue;
          const prev = quotes.get(m.attrs!.clipId);
          quotes.set(m.attrs!.clipId, { beatId: prev?.beatId ?? beatId, quote: (prev?.quote ?? "") + (n.text ?? "") });
        }
      }
      n.content?.forEach(walk);
    };
    walk(block);
  }
  return quotes;
}

export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Cheap stable hash for change detection (FNV-1a). */
export function hashText(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
