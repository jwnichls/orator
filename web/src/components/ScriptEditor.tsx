import { EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useState } from "react";
import { api } from "../api";
import { currentTarget } from "../editor/commands";
import { dictationSupported, useDictation } from "../editor/dictation";
import type { Target } from "./Workspace";

const HELPERS: { action: string; label: string; title: string }[] = [
  { action: "tighten", label: "Tighten", title: "Cut filler, keep every idea" },
  { action: "spoken", label: "Make spoken", title: "Shorter sentences, natural rhythm" },
  { action: "simplify", label: "Simplify", title: "Plain words for non-experts" },
  { action: "expand", label: "Expand", title: "Add elaboration or an example" },
  { action: "transition", label: "Transition", title: "Smooth the hand-off from what came before" },
  { action: "hook", label: "Hook", title: "Make it a stronger opening" },
];

interface Suggestion {
  from: number;
  to: number;
  original: string;
  replacement: string;
  rationale: string;
}


function toParagraphs(text: string) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export function ScriptEditor({
  editor,
  aiAvailable,
  onFindImages,
  setStatus,
}: {
  editor: Editor | null;
  aiAvailable: boolean;
  onFindImages: (t: Target) => void;
  setStatus: (s: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const dictation = useDictation(editor, setStatus);

  if (!editor) return <main className="script-pane" />;

  const runHelper = async (action: string, custom?: string, target?: { from: number; to: number; text: string }) => {
    const t = target ?? currentTarget(editor);
    if (!t) return;
    const doc = editor.state.doc;
    setBusy(action);
    setSuggestion(null);
    try {
      const res = await api.helper({
        action,
        instruction: custom,
        selection: t.text,
        before: doc.textBetween(Math.max(0, t.from - 1200), t.from, "\n\n"),
        after: doc.textBetween(t.to, Math.min(doc.content.size, t.to + 600), "\n\n"),
      });
      setSuggestion({ from: t.from, to: t.to, original: t.text, replacement: res.replacement, rationale: res.rationale });
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(null);
      setAskOpen(false);
    }
  };

  const accept = () => {
    if (!suggestion) return;
    const current = editor.state.doc.textBetween(suggestion.from, suggestion.to, "\n\n").trim();
    if (current !== suggestion.original) {
      setStatus("The text changed since this suggestion was made; discarded.");
      setSuggestion(null);
      return;
    }
    // First paragraph replaces the range in place (so text before/after it stays in the same paragraph);
    // each further paragraph splits off after it.
    const [first, ...rest] = toParagraphs(suggestion.replacement);
    let chain = editor.chain().focus().insertContentAt({ from: suggestion.from, to: suggestion.to }, first ?? "");
    for (const p of rest) chain = chain.splitBlock().insertContent(p);
    chain.run();
    setSuggestion(null);
  };

  const tidyDictation = () => {
    const r = dictation.lastRange;
    if (!r) return;
    const raw = editor.state.doc.textBetween(r.from, r.to, "\n\n");
    // Skip the separating space dictation added, so the tidied text doesn't swallow it.
    const lead = /^[ \t]*/.exec(raw)![0].length;
    const text = raw.trim();
    dictation.clearRange();
    if (text) runHelper("tidy", undefined, { from: r.from + lead, to: r.to, text });
  };

  const isHeading = editor.isActive("heading");
  const isAside = editor.isActive("paragraph", { kind: "aside" });

  return (
    <main className="script-pane">
      <div className="script-toolbar">
        <button
          className={isHeading ? "toggle on" : "toggle"}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Turn this paragraph into a section heading (optional)"
        >
          § Section
        </button>
        <button
          className={isAside ? "toggle on" : "toggle"}
          onClick={() => editor.chain().focus().toggleAside().run()}
          title="Mark as an aside: optional material you may skip when presenting"
        >
          ⤷ Aside
        </button>
        <button
          onClick={() => {
            const t = currentTarget(editor);
            if (t) onFindImages(t);
          }}
          title="Find images for the selection or current paragraph"
        >
          🖼 Find images
        </button>
        {dictationSupported && (
          <button
            className={dictation.listening ? "toggle on recording" : "toggle"}
            onClick={dictation.listening ? dictation.stop : dictation.start}
            title='Speak your script at the cursor. Say "new paragraph" to start a new paragraph.'
          >
            {dictation.listening ? "■ Stop" : "🎙 Dictate"}
          </button>
        )}
        <span className="muted small hint">Select text for writing help.</span>
      </div>

      <div
        className="script-scroll"
        onMouseDown={(e) => {
          // Clicking the blank page below the text should place the cursor at the end, like a word processor.
          if (!(e.target as HTMLElement).closest(".ProseMirror")) {
            e.preventDefault();
            editor.commands.focus("end");
          }
        }}
      >
        <EditorContent editor={editor} className="script-editor" />
      </div>

      {dictation.listening && (
        <div className="dictation-strip">
          <span className="rec-dot" />
          {dictation.interim ? <span className="interim">{dictation.interim}</span> : <span className="muted small">Listening… say “new paragraph” to break.</span>}
        </div>
      )}
      {!dictation.listening && dictation.lastRange && !suggestion && (
        <div className="dictation-strip">
          <span className="small">Dictation added.</span>
          {aiAvailable && (
            <button className="small primary" disabled={!!busy} onClick={tidyDictation} title="Fix punctuation, remove filler words and add paragraph breaks, keeping your wording">
              {busy === "tidy" ? "Tidying…" : "Tidy it up"}
            </button>
          )}
          <button className="small ghost" onClick={dictation.clearRange}>
            Keep as is
          </button>
        </div>
      )}

      <BubbleMenu
        editor={editor}
        shouldShow={({ editor, state, view, element }) =>
          (view.hasFocus() || element.contains(document.activeElement)) &&
          !state.selection.empty &&
          editor.isEditable &&
          !editor.isActive("heading")
        }
        className="bubble"
      >
        {aiAvailable &&
          HELPERS.map((h) => (
            <button key={h.action} title={h.title} disabled={!!busy} onClick={() => runHelper(h.action)}>
              {busy === h.action ? "…" : h.label}
            </button>
          ))}
        {aiAvailable && (
          <button disabled={!!busy} onClick={() => setAskOpen((o) => !o)} title="Give your own instruction">
            Ask…
          </button>
        )}
        <span className="sep" />
        <button
          onClick={() => {
            const t = currentTarget(editor);
            if (t) onFindImages(t);
          }}
        >
          🖼 Images
        </button>
        {askOpen && (
          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (instruction.trim()) runHelper("custom", instruction.trim());
            }}
          >
            <input autoFocus placeholder="e.g. add a concrete example" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <button type="submit" disabled={!!busy}>
              {busy === "custom" ? "…" : "Go"}
            </button>
          </form>
        )}
      </BubbleMenu>

      {suggestion && (
        <div className="suggestion">
          <div className="suggestion-head">
            <strong>Suggested edit</strong>
            <span className="muted small">{suggestion.rationale}</span>
          </div>
          <div className="diff">
            <div className="del">{suggestion.original}</div>
            <div className="ins">{suggestion.replacement}</div>
          </div>
          <div className="row">
            <button className="primary" onClick={accept}>
              Accept
            </button>
            <button onClick={() => setSuggestion(null)}>Dismiss</button>
          </div>
        </div>
      )}
    </main>
  );
}
