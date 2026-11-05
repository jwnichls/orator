import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { nanoid } from "nanoid";

const BLOCK_TYPES = ["paragraph", "heading"];

/**
 * Gives every top-level paragraph (beat) and heading (section) a stable id, and lets paragraphs be
 * marked as asides. Ids are re-issued when a split/paste produces duplicates.
 */
export const BeatIds = Extension.create({
  name: "beatIds",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          id: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-id"),
            renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
          },
        },
      },
      {
        types: ["paragraph"],
        attributes: {
          kind: {
            default: "main",
            parseHTML: (el) => el.getAttribute("data-kind") ?? "main",
            renderHTML: (attrs) => (attrs.kind === "aside" ? { "data-kind": "aside" } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      toggleAside:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from, $to } = state.selection;
          const range = $from.blockRange($to);
          if (!range) return false;
          let next: string | null = null;
          state.doc.nodesBetween(range.start, range.end, (node, pos) => {
            if (node.type.name !== "paragraph") return;
            if (next === null) next = node.attrs.kind === "aside" ? "main" : "aside";
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind: next });
          });
          if (dispatch) dispatch(tr);
          return next !== null;
        },
    };
  },

  onCreate() {
    // An empty transaction runs appendTransaction so a freshly loaded doc gets ids immediately.
    this.editor.view.dispatch(this.editor.state.tr);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("beatIds"),
        appendTransaction: (_transactions, _old, state) => {
          const seen = new Set<string>();
          const tr = state.tr;
          let changed = false;
          state.doc.forEach((node, offset) => {
            if (!BLOCK_TYPES.includes(node.type.name)) return;
            const id = node.attrs.id as string | null;
            if (!id || seen.has(id)) {
              const fresh = nanoid(10);
              tr.setNodeMarkup(offset, undefined, { ...node.attrs, id: fresh });
              seen.add(fresh);
              changed = true;
            } else {
              seen.add(id);
            }
          });
          return changed ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    beatIds: { toggleAside: () => ReturnType };
    clip: {
      addClipMark: (clipId: string) => ReturnType;
      removeClipMark: (clipId: string) => ReturnType;
    };
  }
}

/** Anchors gathered content to a span of script. Multiple clips may overlap the same text. */
export const ClipMark = Mark.create({
  name: "clip",
  excludes: "",
  inclusive: false,

  addAttributes() {
    return {
      clipId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-clip-id"),
        renderHTML: (attrs) => ({ "data-clip-id": attrs.clipId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-clip-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "clip-anchor" }), 0];
  },

  addCommands() {
    return {
      addClipMark:
        (clipId) =>
        ({ commands }) =>
          commands.setMark(this.name, { clipId }),
      removeClipMark:
        (clipId) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks.clip;
          state.doc.descendants((node, pos) => {
            for (const m of node.marks) {
              if (m.type === type && m.attrs.clipId === clipId) tr.removeMark(pos, pos + node.nodeSize, m);
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
