import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { api, type CoachResult } from "../api";
import type { deriveStructure } from "../model/derive";
import { hashText } from "../model/derive";
import type { Beat, Talk } from "../model/types";
import { jumpToBeat } from "../editor/commands";

type Structure = ReturnType<typeof deriveStructure>;


function snippet(text: string, words = 12) {
  const w = text.split(/\s+/).filter(Boolean);
  return w.slice(0, words).join(" ") + (w.length > words ? "…" : "");
}

export function LeftPane(props: {
  editor: Editor | null;
  talk: Talk;
  structure: Structure;
  aiAvailable: boolean;
  liveOutline: boolean;
  setLiveOutline: (v: boolean) => void;
  setStatus: (s: string) => void;
}) {
  const [tab, setTab] = useState<"outline" | "coach">("outline");
  return (
    <aside className="left-pane">
      <div className="tabs">
        <button className={tab === "outline" ? "tab on" : "tab"} onClick={() => setTab("outline")}>
          Outline
        </button>
        <button className={tab === "coach" ? "tab on" : "tab"} onClick={() => setTab("coach")}>
          Story coach
        </button>
      </div>
      {tab === "outline" ? <Outline {...props} /> : <Coach {...props} />}
    </aside>
  );
}

function Outline({ editor, talk, structure, aiAvailable, liveOutline, setLiveOutline, setStatus }: Parameters<typeof LeftPane>[0]) {
  const [proposal, setProposal] = useState<Awaited<ReturnType<typeof api.sections>> | null>(null);
  const [busy, setBusy] = useState(false);

  const groups: { id: string | null; title: string | null; beats: Beat[] }[] = [];
  for (const b of structure.beats) {
    const last = groups[groups.length - 1];
    if (last && last.id === (b.sectionId ?? null)) last.beats.push(b);
    else groups.push({ id: b.sectionId ?? null, title: b.sectionTitle ?? null, beats: [b] });
  }
  // Include empty sections so headings are visible as soon as they're typed.
  for (const s of structure.sections) if (!groups.some((g) => g.id === s.id)) groups.push({ id: s.id, title: s.title, beats: [] });

  const suggest = async () => {
    setBusy(true);
    try {
      setProposal(await api.sections({ beats: structure.beats.map((b) => ({ id: b.id, text: b.text, kind: b.kind })) }));
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyProposal = () => {
    if (!editor || !proposal) return;
    const { state } = editor;
    const tr = state.tr;
    const heading = state.schema.nodes.heading;
    const starts = new Map(proposal.sections.map((s) => [s.startBeatId, s.title]));
    const ops: { pos: number; kind: "delete" | "insert"; size?: number; title?: string }[] = [];
    state.doc.forEach((node, offset) => {
      if (node.type.name === "heading") ops.push({ pos: offset, kind: "delete", size: node.nodeSize });
      const title = starts.get(node.attrs.id);
      if (title) ops.push({ pos: offset, kind: "insert", title });
    });
    // Apply from the end so earlier positions stay valid.
    for (const op of ops.sort((a, b) => b.pos - a.pos || (a.kind === "delete" ? -1 : 1))) {
      if (op.kind === "delete") tr.delete(op.pos, op.pos + op.size!);
      else tr.insert(op.pos, heading.create({ level: 2 }, state.schema.text(op.title!)));
    }
    editor.view.dispatch(tr);
    setProposal(null);
  };

  return (
    <div className="pane-body">
      <div className="row between">
        <label className="small" title="Summarize each paragraph's point as you write (reverse outline)">
          <input type="checkbox" checked={liveOutline} onChange={(e) => setLiveOutline(e.target.checked)} disabled={!aiAvailable} /> Live
          points
        </label>
        <button className="small" disabled={!aiAvailable || busy || structure.beats.length < 3} onClick={suggest}>
          {busy ? "Thinking…" : "Suggest sections"}
        </button>
      </div>

      {proposal && (
        <div className="card proposal">
          <div className="small muted">{proposal.rationale}</div>
          <ol>
            {proposal.sections.map((s) => (
              <li key={s.startBeatId}>
                <strong>{s.title}</strong>
                <div className="small muted">{s.purpose}</div>
              </li>
            ))}
          </ol>
          {structure.sections.length > 0 && <div className="small warn-text">Replaces your {structure.sections.length} existing section headings.</div>}
          <div className="row">
            <button className="primary small" onClick={applyProposal}>
              Apply
            </button>
            <button className="small" onClick={() => setProposal(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {structure.beats.length === 0 && <p className="muted small">Your outline appears here as you write.</p>}
      {groups.map((g, i) => (
        <div key={g.id ?? `none-${i}`} className="outline-group">
          {g.title && (
            <div className="outline-section" onClick={() => editor && g.id && jumpToBeat(editor, g.id)}>
              {g.title}
            </div>
          )}
          {g.beats.map((b) => {
            const p = talk.points[b.id];
            const fresh = p && p.hash === hashText(b.text);
            return (
              <div
                key={b.id}
                className={`outline-beat ${b.kind === "aside" ? "aside" : ""}`}
                onClick={() => editor && jumpToBeat(editor, b.id)}
                title={b.text}
              >
                <span className={fresh ? "" : "muted"}>{p ? p.text : snippet(b.text)}</span>
                {b.kind === "aside" && <span className="badge">aside</span>}
                {b.clipIds.length > 0 && <span className="badge">🖼 {b.clipIds.length}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Coach({ editor, structure, aiAvailable, setStatus }: Parameters<typeof LeftPane>[0]) {
  const [lenses, setLenses] = useState<Record<string, string>>({});
  const [lens, setLens] = useState("none");
  const [audience, setAudience] = useState("");
  const [result, setResult] = useState<CoachResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.lenses().then(setLenses).catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      setResult(
        await api.coach({
          lens,
          audience: audience.trim() || undefined,
          beats: structure.beats.map((b) => ({ id: b.id, text: b.text, kind: b.kind, section: b.sectionTitle })),
        }),
      );
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const LENS_LABELS: Record<string, string> = {
    none: "No lens — judge on its own terms",
    scr: "Situation · Complication · Resolution",
    "problem-solution": "Problem · Solution · Benefit",
    "what-is-could-be": "What is / What could be",
    hero: "Audience as hero",
    "and-but-therefore": "And · But · Therefore",
  };

  return (
    <div className="pane-body">
      <p className="small muted">Critique of your narrative arc. A lens is a way of looking, not a template to fill.</p>
      <label className="field">
        <span className="small">Lens</span>
        <select value={lens} onChange={(e) => setLens(e.target.value)} title={lenses[lens]}>
          {Object.keys(lenses).length === 0 && <option value="none">{LENS_LABELS.none}</option>}
          {Object.keys(lenses).map((k) => (
            <option key={k} value={k}>
              {LENS_LABELS[k] ?? k}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="small">Audience (optional)</span>
        <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. hospital administrators" />
      </label>
      <button className="primary" disabled={!aiAvailable || busy || structure.beats.length < 2} onClick={run}>
        {busy ? "Reading your script…" : "Critique story"}
      </button>

      {result && (
        <div className="coach-result">
          <div className="card">
            <div className="small muted">Throughline</div>
            <div className="throughline">{result.throughline}</div>
            <p className="small">{result.summary}</p>
          </div>
          {result.strengths.length > 0 && (
            <div className="card">
              <div className="small muted">Working well</div>
              <ul className="small">
                {result.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {result.issues.map((iss, i) => (
            <div
              key={i}
              className={`card issue ${iss.beatId ? "clickable" : ""}`}
              onClick={() => editor && iss.beatId && jumpToBeat(editor, iss.beatId)}
            >
              <div className="small">
                <strong>{iss.issue}</strong>
              </div>
              <div className="small muted">{iss.suggestion}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
