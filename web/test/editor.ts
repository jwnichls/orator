import { Editor, type JSONContent } from "@tiptap/react";
import { scriptExtensions } from "../src/editor/setup";

/** A real script editor (same extensions as the app) mounted in jsdom. */
export function makeEditor(content: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: scriptExtensions(), content });
}

type Inline = string | { text: string; clip?: string | string[] };

function inline(parts: Inline[]): JSONContent[] {
  return parts.map((part) => {
    if (typeof part === "string") return { type: "text", text: part };
    const clips = part.clip === undefined ? [] : Array.isArray(part.clip) ? part.clip : [part.clip];
    return { type: "text", text: part.text, marks: clips.map((clipId) => ({ type: "clip", attrs: { clipId } })) };
  });
}

export const p = (id: string | null, ...parts: Inline[]): JSONContent => ({ type: "paragraph", attrs: { id }, content: inline(parts) });
export const aside = (id: string, ...parts: Inline[]): JSONContent => ({ type: "paragraph", attrs: { id, kind: "aside" }, content: inline(parts) });
export const h = (id: string, title: string): JSONContent => ({ type: "heading", attrs: { id, level: 2 }, content: title ? [{ type: "text", text: title }] : [] });
export const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

/** Position just inside the start of the top-level block with this id. */
export function blockStart(editor: Editor, id: string) {
  let pos = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.attrs.id === id) pos = offset + 1;
  });
  if (pos < 0) throw new Error(`no block ${id}`);
  return pos;
}

export const texts = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(n.textContent));
  return out;
};
