import { useEditor } from "@tiptap/react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { scriptExtensions } from "../editor/setup";
import { download, exportBundle } from "../model/bundle";
import { deriveStructure, hashText, wordCount } from "../model/derive";
import { getTalk, saveTalk } from "../model/store";
import type { Asset, Talk } from "../model/types";
import { ContentPane } from "./ContentPane";
import { LeftPane } from "./LeftPane";
import { ScriptEditor } from "./ScriptEditor";

export interface Target {
  from: number;
  to: number;
  text: string;
  beatId?: string;
}

const MIN_WORDS_FOR_POINT = 8;

export function Workspace({ talkId, onClose, aiAvailable }: { talkId: string; onClose: () => void; aiAvailable: boolean }) {
  const [talk, setTalk] = useState<Talk | null | undefined>(undefined);

  useEffect(() => {
    getTalk(talkId).then((t) => setTalk(t ?? null));
  }, [talkId]);

  if (talk === undefined) return <div className="loading">Loading…</div>;
  if (talk === null)
    return (
      <div className="loading">
        Talk not found. <button onClick={onClose}>Back</button>
      </div>
    );
  return <LoadedWorkspace initial={talk} onClose={onClose} aiAvailable={aiAvailable} />;
}

function LoadedWorkspace({ initial, onClose, aiAvailable }: { initial: Talk; onClose: () => void; aiAvailable: boolean }) {
  const [talk, setTalk] = useState(initial);
  const [liveOutline, setLiveOutline] = useState(true);
  const [target, setTarget] = useState<Target | null>(null);
  const [rightTab, setRightTab] = useState<"find" | "gathered">("gathered");
  const [cursorClipIds, setCursorClipIds] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const editor = useEditor({
    extensions: scriptExtensions(),
    content: initial.doc,
    autofocus: "end",
    onUpdate: ({ editor }) => setTalk((t) => ({ ...t, doc: editor.getJSON(), updatedAt: Date.now() })),
    onSelectionUpdate: ({ editor }) => {
      const ids = new Set<string>();
      const { $from } = editor.state.selection;
      for (const m of $from.marks()) if (m.type.name === "clip") ids.add(m.attrs.clipId);
      setCursorClipIds([...ids]);
    },
  });

  // ---- Persistence (debounced) ----
  const talkRef = useRef(talk);
  useEffect(() => {
    talkRef.current = talk;
  }, [talk]);
  const saveTimer = useRef<number>(undefined);
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveTalk(talk), 400);
    return () => window.clearTimeout(saveTimer.current);
  }, [talk]);
  useEffect(() => () => void saveTalk(talkRef.current), []);

  const structure = useMemo(() => deriveStructure(talk.doc), [talk.doc]);

  // ---- Live reverse outline: regenerate points for beats whose text changed ----
  const pointsBusy = useRef(false);
  useEffect(() => {
    if (!aiAvailable || !liveOutline) return;
    const timer = window.setTimeout(async () => {
      if (pointsBusy.current) return;
      const stale = structure.beats.filter(
        (b) => wordCount(b.text) >= MIN_WORDS_FOR_POINT && talkRef.current.points[b.id]?.hash !== hashText(b.text),
      );
      if (!stale.length) return;
      pointsBusy.current = true;
      try {
        const batch = stale.slice(0, 20);
        const { points } = await api.points({
          beats: batch.map((b) => ({ id: b.id, text: b.text })),
          context: structure.beats.map((b) => ({ id: b.id, text: b.text, kind: b.kind, section: b.sectionTitle })),
        });
        const hashes = new Map(batch.map((b) => [b.id, hashText(b.text)]));
        setTalk((t) => {
          const next = { ...t.points };
          for (const p of points) if (hashes.has(p.id)) next[p.id] = { text: p.point, hash: hashes.get(p.id)! };
          return { ...t, points: next };
        });
      } catch (e) {
        setStatus(`Outline: ${(e as Error).message}`);
      } finally {
        pointsBusy.current = false;
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [structure, aiAvailable, liveOutline]);

  // ---- Clips ----
  const attachAsset = useCallback(
    (asset: Asset, at: Target, caption?: string) => {
      if (!editor) return;
      const clipId = nanoid(10);
      setTalk((t) => ({ ...t, clips: { ...t.clips, [clipId]: { id: clipId, assetId: asset.id, caption, createdAt: Date.now() } } }));
      const max = editor.state.doc.content.size;
      editor
        .chain()
        .setTextSelection({ from: Math.min(at.from, max), to: Math.min(at.to, max) })
        .addClipMark(clipId)
        .setTextSelection(Math.min(at.to, max))
        .run();
      setStatus("Added to gathered content");
    },
    [editor],
  );

  const removeClip = useCallback(
    (clipId: string) => {
      editor?.commands.removeClipMark(clipId);
      setTalk((t) => {
        const clips = { ...t.clips };
        delete clips[clipId];
        return { ...t, clips };
      });
    },
    [editor],
  );

  const reanchorClip = useCallback(
    (clipId: string, at: Target) => {
      if (!editor) return;
      editor.commands.removeClipMark(clipId);
      editor.chain().setTextSelection({ from: at.from, to: at.to }).addClipMark(clipId).run();
    },
    [editor],
  );

  const updateClip = useCallback((clipId: string, patch: { caption?: string; note?: string }) => {
    setTalk((t) => ({ ...t, clips: { ...t.clips, [clipId]: { ...t.clips[clipId], ...patch } } }));
  }, []);

  const findImagesFor = useCallback((t: Target) => {
    setTarget(t);
    setRightTab("find");
  }, []);

  const onExport = async () => {
    try {
      await saveTalk(talk);
      const blob = await exportBundle(talk);
      download(blob, `${talk.title.replace(/[^\w\- ]+/g, "").trim() || "talk"}.orator`);
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(t);
  }, [status]);

  const totalWords = structure.beats.filter((b) => b.kind === "main").reduce((n, b) => n + wordCount(b.text), 0);

  return (
    <div className="workspace">
      <header className="topbar">
        <button className="ghost" onClick={onClose} title="All talks">
          ← Talks
        </button>
        <input
          className="title-input"
          value={talk.title}
          onChange={(e) => setTalk((t) => ({ ...t, title: e.target.value, updatedAt: Date.now() }))}
          aria-label="Talk title"
        />
        <span className="muted small">{totalWords} words</span>
        <div className="spacer" />
        {status && <span className="status small">{status}</span>}
        {!aiAvailable && (
          <a className="warn small" href="#/account" title="AI features use your own Anthropic API key">
            Add your API key to use AI
          </a>
        )}
        <button onClick={onExport} title="Export a self-contained bundle (script + all images) for offline use">
          Export .orator
        </button>
        <a className="ghost account-link" href="#/account" title="Account">
          Account
        </a>
      </header>
      <div className="panes">
        <LeftPane
          editor={editor}
          talk={talk}
          structure={structure}
          aiAvailable={aiAvailable}
          liveOutline={liveOutline}
          setLiveOutline={setLiveOutline}
          setStatus={setStatus}
        />
        <ScriptEditor editor={editor} aiAvailable={aiAvailable} onFindImages={findImagesFor} setStatus={setStatus} />
        <ContentPane
          editor={editor}
          talk={talk}
          structure={structure}
          tab={rightTab}
          setTab={setRightTab}
          target={target}
          setTarget={setTarget}
          cursorClipIds={cursorClipIds}
          aiAvailable={aiAvailable}
          attachAsset={attachAsset}
          removeClip={removeClip}
          reanchorClip={reanchorClip}
          updateClip={updateClip}
          setStatus={setStatus}
        />
      </div>
    </div>
  );
}
