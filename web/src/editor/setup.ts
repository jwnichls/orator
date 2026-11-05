import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { BeatIds, ClipMark } from "./extensions";

/** The script editor's schema and behavior, shared by the app and tests. */
export function scriptExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [2] },
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      link: false,
    }),
    Placeholder.configure({
      // The writing prompt is only for a blank script; empty paragraphs mid-script stay quiet.
      placeholder: ({ editor, node }) =>
        node.type.name === "heading" ? "Section title" : editor.isEmpty ? "Start writing what you'll say…" : "",
    }),
    BeatIds,
    ClipMark,
  ];
}
