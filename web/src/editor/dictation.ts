import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (Chrome/Edge/Safari expose it as webkitSpeechRecognition).
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const getCtor = (): RecognitionCtor | undefined =>
  (window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const dictationSupported = !!getCtor();

const NEW_PARAGRAPH = /\b(new paragraph|next paragraph)\b[.,]?/gi;

/** The span of the document written during the last dictation session, kept valid as the doc changes. */
export interface DictatedRange {
  from: number;
  to: number;
}

export function useDictation(editor: Editor | null, onError: (msg: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [lastRange, setLastRange] = useState<DictatedRange | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const range = useRef<DictatedRange | null>(null);

  // Keep the dictated range mapped through every edit, so "Tidy" targets the right text later.
  useEffect(() => {
    if (!editor) return;
    const onTx = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map(pos: number, assoc?: number): number } } }) => {
      if (!transaction.docChanged || !range.current) return;
      const r = range.current;
      range.current = { from: transaction.mapping.map(r.from, -1), to: transaction.mapping.map(r.to, 1) };
      if (!wanted.current) setLastRange(range.current.to > range.current.from ? { ...range.current } : null);
    };
    editor.on("transaction", onTx);
    return () => void editor.off("transaction", onTx);
  }, [editor]);

  const insertSpoken = useCallback(
    (raw: string) => {
      if (!editor) return;
      const parts = raw.split(NEW_PARAGRAPH);
      parts.forEach((part, i) => {
        if (i % 2 === 1) {
          editor.chain().focus().splitBlock().run();
          return;
        }
        const text = part.trim();
        if (!text) return;
        const { $from } = editor.state.selection;
        const prev = $from.parent.textBetween(0, $from.parentOffset);
        const needsSpace = prev.length > 0 && !/\s$/.test(prev);
        const capitalize = prev.trim() === "" || /[.!?]\s*$/.test(prev);
        const out = (needsSpace ? " " : "") + (capitalize ? text[0].toUpperCase() + text.slice(1) : text);
        editor.chain().focus().insertContent(out).run();
      });
      if (range.current) range.current = { ...range.current, to: editor.state.selection.to };
    },
    [editor],
  );

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || !editor || wanted.current) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) insertSpoken(res[0].transcript);
        else pending += res[0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted.current = false;
      onError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access was blocked. Allow it in the browser's site settings."
          : `Dictation error: ${e.error}`,
      );
    };
    // Recognition ends on its own after silence; keep going until the user stops.
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
          return;
        } catch {
          /* fall through to stopped */
        }
      }
      wanted.current = false;
      setListening(false);
      setInterim("");
      const done = range.current;
      setLastRange(done && done.to > done.from ? { ...done } : null);
    };
    const pos = editor.state.selection.to;
    editor.commands.setTextSelection(pos);
    range.current = { from: pos, to: pos };
    setLastRange(null);
    wanted.current = true;
    rec.current = r;
    r.start();
    setListening(true);
  }, [editor, insertSpoken, onError]);

  useEffect(() => () => stop(), [stop]);

  const clearRange = useCallback(() => {
    range.current = null;
    setLastRange(null);
  }, []);

  return { listening, interim, lastRange, start, stop, clearRange };
}
