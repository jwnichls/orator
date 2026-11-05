import type { Editor } from "@tiptap/react";
import type { Target } from "../components/Workspace";

/** The target range for an action: the selection, or the whole paragraph when the selection is empty. */
export function currentTarget(editor: Editor): Target | null {
  const { state } = editor;
  let { from, to } = state.selection;
  const { $from } = state.selection;
  const beatId = $from.node(1)?.attrs?.id as string | undefined;
  if (from === to) {
    if ($from.depth < 1) return null;
    from = $from.start(1);
    to = $from.end(1);
  }
  const text = state.doc.textBetween(from, to, "\n\n").trim();
  return text ? { from, to, text, beatId } : null;
}

export function findBlockPos(editor: Editor, id: string) {
  let found: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (found === null && node.attrs.id === id) found = offset;
  });
  return found;
}

export function jumpToBeat(editor: Editor, id: string) {
  const pos = findBlockPos(editor, id);
  if (pos === null) return;
  editor.chain().focus().setTextSelection(pos + 1).run();
  (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
}
