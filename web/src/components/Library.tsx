import { useEffect, useRef, useState } from "react";
import { importBundle } from "../model/bundle";
import { deriveStructure, wordCount } from "../model/derive";
import { deleteTalk, listTalks, newTalk, saveTalk } from "../model/store";
import type { Talk } from "../model/types";

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [talks, setTalks] = useState<Talk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => listTalks().then(setTalks);
  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    const talk = newTalk();
    await saveTalk(talk);
    onOpen(talk.id);
  };

  const onImport = async (file?: File) => {
    if (!file) return;
    try {
      const talk = await importBundle(file);
      onOpen(talk.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (talk: Talk) => {
    if (!window.confirm(`Delete “${talk.title}”? This cannot be undone.`)) return;
    await deleteTalk(talk.id);
    refresh();
  };

  return (
    <div className="library">
      <header className="library-header">
        <h1>Orator</h1>
        <p className="muted">Write what you'll say. Gather what they'll see.</p>
        <div className="row">
          <button className="primary" onClick={create}>New talk</button>
          <button onClick={() => fileInput.current?.click()}>Import .orator…</button>
          <input ref={fileInput} type="file" accept=".orator,.zip" hidden onChange={(e) => onImport(e.target.files?.[0])} />
        </div>
        {error && <p className="error">{error}</p>}
      </header>
      <ul className="talk-list">
        {talks?.length === 0 && <li className="muted">No talks yet.</li>}
        {talks?.map((t) => {
          const { beats, sections } = deriveStructure(t.doc);
          const words = beats.reduce((n, b) => n + wordCount(b.text), 0);
          return (
            <li key={t.id} className="talk-card" onClick={() => onOpen(t.id)}>
              <div>
                <div className="talk-title">{t.title}</div>
                <div className="muted small">
                  {words} words · {beats.length} paragraphs · {sections.length} sections · {Object.keys(t.clips).length} clips · edited{" "}
                  {new Date(t.updatedAt).toLocaleString()}
                </div>
              </div>
              <button
                className="ghost small"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(t);
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
