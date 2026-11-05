import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ImageResult } from "../api";
import { clipQuotes, type deriveStructure } from "../model/derive";
import { assetUrl, getAsset, importRemoteImage, putAssetBlob } from "../model/store";
import type { Asset, Clip, Talk } from "../model/types";
import { currentTarget, jumpToBeat } from "../editor/commands";
import type { Target } from "./Workspace";

type Structure = ReturnType<typeof deriveStructure>;

interface Props {
  editor: Editor | null;
  talk: Talk;
  structure: Structure;
  tab: "find" | "gathered";
  setTab: (t: "find" | "gathered") => void;
  target: Target | null;
  setTarget: (t: Target | null) => void;
  cursorClipIds: string[];
  aiAvailable: boolean;
  attachAsset: (asset: Asset, at: Target, caption?: string) => void;
  removeClip: (id: string) => void;
  reanchorClip: (id: string, at: Target) => void;
  updateClip: (id: string, patch: { caption?: string; note?: string }) => void;
  setStatus: (s: string) => void;
}

export function ContentPane(props: Props) {
  const { tab, setTab, talk } = props;
  const count = Object.keys(talk.clips).length;
  return (
    <aside className="right-pane">
      <div className="tabs">
        <button className={tab === "find" ? "tab on" : "tab"} onClick={() => setTab("find")}>
          Find
        </button>
        <button className={tab === "gathered" ? "tab on" : "tab"} onClick={() => setTab("gathered")}>
          Gathered{count ? ` (${count})` : ""}
        </button>
      </div>
      {tab === "find" ? <Find {...props} /> : <Gathered {...props} />}
    </aside>
  );
}

function AssetImage({ assetId, className }: { assetId: string; className?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    assetUrl(assetId).then(setUrl);
  }, [assetId]);
  return url ? <img className={className} src={url} alt="" /> : <div className={`${className} placeholder`} />;
}

function Spinner() {
  return <span className="spinner" aria-hidden />;
}

// ---------------- Find ----------------

function Find({ editor, structure, target, setTarget, aiAvailable, attachAsset, setStatus }: Props) {
  const [ideas, setIdeas] = useState<{ idea: string; queries: string[] }[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ImageResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImageResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Only the latest search may update results; a slow earlier one finishing last must not overwrite them.
  const searchSeq = useRef(0);

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const res = await api.searchImages(q);
      if (seq !== searchSeq.current) return;
      setResults(res.results);
      if (res.errors.length) setStatus(`Some sources failed: ${res.errors.join("; ")}`);
    } catch (e) {
      if (seq === searchSeq.current) setStatus((e as Error).message);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  // When a new passage is targeted, ask for visual ideas and run the first query.
  useEffect(() => {
    setIdeas(null);
    setResults(null);
    setPreview(null);
    searchSeq.current++; // drop any search still running for the previous passage
    setSearching(false);
    if (!target) return;
    if (!aiAvailable) return; // without AI the user types their own query
    let cancelled = false;
    setIdeasBusy(true);
    const context = structure.beats.map((b) => b.text).join("\n\n").slice(0, 6000);
    api
      .visualIdeas({ passage: target.text, context })
      .then((r) => {
        if (cancelled) return;
        setIdeas(r.ideas);
        const first = r.ideas[0]?.queries[0];
        if (first) search(first);
      })
      .catch((e) => !cancelled && setStatus((e as Error).message))
      .finally(() => !cancelled && setIdeasBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, aiAvailable]);

  const add = async (r: ImageResult) => {
    if (!target) return;
    setAdding(r.id);
    try {
      const asset = await importRemoteImage(r.url, {
        provider: r.provider,
        url: r.url,
        pageUrl: r.pageUrl,
        title: r.title,
        creator: r.creator,
        license: r.license,
        licenseUrl: r.licenseUrl,
      });
      attachAsset(asset, target);
      setPreview(null);
    } catch (e) {
      setStatus(`Couldn't add image: ${(e as Error).message}`);
    } finally {
      setAdding(null);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || !target) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const asset = await putAssetBlob(f, { provider: "upload", title: f.name });
        attachAsset(asset, target);
      } catch (e) {
        setStatus(`Couldn't add ${f.name}: ${(e as Error).message}`);
      }
    }
  };

  const useSelection = () => editor && setTarget(currentTarget(editor));

  return (
    <div
      className="pane-body"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      {target ? (
        <div className="target">
          <div className="small muted">Finding visuals for</div>
          <blockquote>{target.text.length > 280 ? target.text.slice(0, 280) + "…" : target.text}</blockquote>
          <div className="row">
            <button className="small" onClick={useSelection}>
              Use current selection
            </button>
            <button className="small" onClick={() => fileInput.current?.click()}>
              Upload your own…
            </button>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>
        </div>
      ) : (
        <div className="empty">
          <p className="muted">Select a passage in your script and choose “Images”, or put your cursor in a paragraph:</p>
          <button onClick={useSelection}>Find images for current paragraph</button>
        </div>
      )}

      {target && (ideasBusy || ideas) && (
        <div className="ideas">
          {ideasBusy ? (
            <div className="loading-row small muted" role="status">
              <Spinner /> Thinking about what could support this…
            </div>
          ) : (
            <div className="small muted">Ideas</div>
          )}
          {ideas?.map((idea, i) => (
            <div key={i} className="idea">
              <div className="small">{idea.idea}</div>
              <div className="chips">
                {idea.queries.map((q) => (
                  <button key={q} className={`chip ${q === query ? "on" : ""}`} onClick={() => search(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {target && (
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Openverse & Wikimedia Commons" />
          <button type="submit" disabled={searching} aria-label="Search">
            {searching ? <Spinner /> : "Search"}
          </button>
        </form>
      )}

      {preview && (
        <div className="preview card">
          <img src={preview.thumbUrl} alt={preview.title} />
          <div className="small">
            <strong>{preview.title || "Untitled"}</strong>
          </div>
          <div className="small muted">
            {preview.creator && <>by {preview.creator} · </>}
            {preview.license ?? "license unknown"} · {preview.provider}
            {preview.width && ` · ${preview.width}×${preview.height}`}
          </div>
          <div className="row">
            <button className="primary small" disabled={adding === preview.id} onClick={() => add(preview)}>
              {adding === preview.id ? "Downloading…" : "Add to passage"}
            </button>
            {preview.pageUrl && (
              <a className="small" href={preview.pageUrl} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            )}
            <button className="small" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {searching && (
        <div className="loading-row small muted" role="status">
          <Spinner /> Searching Openverse &amp; Wikimedia Commons for “{query}”…
        </div>
      )}
      {searching && !results && (
        <div className="grid" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="grid-item skeleton" />
          ))}
        </div>
      )}
      {!searching && results && results.length === 0 && <p className="muted small">No results.</p>}
      {results && (
        <div className={searching ? "grid stale" : "grid"} aria-busy={searching}>
          {results.map((r) => (
            <ResultTile key={`${r.provider}-${r.id}`} result={r} onClick={() => setPreview(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A search result thumbnail. Provider thumbnail services sometimes fail: fall back to the full image, then drop the tile. */
function ResultTile({ result, onClick }: { result: ImageResult; onClick: () => void }) {
  const [src, setSrc] = useState(result.thumbUrl);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button className="grid-item" onClick={onClick} title={result.title}>
      <img
        src={src}
        alt={result.title}
        loading="lazy"
        onError={() => (src !== result.url ? setSrc(result.url) : setFailed(true))}
      />
    </button>
  );
}

// ---------------- Gathered ----------------

function Gathered({ editor, talk, cursorClipIds, removeClip, reanchorClip, updateClip }: Props) {
  const quotes = useMemo(() => clipQuotes(talk.doc), [talk.doc]);
  const anchored = [...quotes.keys()].filter((id) => talk.clips[id]);
  const unanchored = Object.keys(talk.clips).filter((id) => !quotes.has(id));
  const here = new Set(cursorClipIds);

  if (Object.keys(talk.clips).length === 0) {
    return (
      <div className="pane-body">
        <p className="muted small">
          Images you gather are anchored to the words they support. Select a passage and choose “Images” to start.
        </p>
      </div>
    );
  }

  const card = (id: string) => (
    <ClipCard
      key={id}
      clip={talk.clips[id]}
      quote={quotes.get(id)?.quote}
      highlighted={here.has(id)}
      onShow={() => {
        const q = quotes.get(id);
        if (editor && q) jumpToBeat(editor, q.beatId);
      }}
      onReanchor={() => {
        const t = editor && currentTarget(editor);
        if (t) reanchorClip(id, t);
      }}
      onRemove={() => removeClip(id)}
      onCaption={(caption) => updateClip(id, { caption })}
    />
  );

  return (
    <div className="pane-body">
      {here.size > 0 && <div className="small muted">At cursor</div>}
      {anchored.filter((id) => here.has(id)).map(card)}
      {here.size > 0 && <div className="small muted">All, in script order</div>}
      {anchored.filter((id) => !here.has(id)).map(card)}
      {unanchored.length > 0 && (
        <>
          <div className="small warn-text">Unanchored — the text they were attached to was deleted</div>
          {unanchored.map(card)}
        </>
      )}
    </div>
  );
}

function ClipCard({
  clip,
  quote,
  highlighted,
  onShow,
  onReanchor,
  onRemove,
  onCaption,
}: {
  clip: Clip;
  quote?: string;
  highlighted: boolean;
  onShow: () => void;
  onReanchor: () => void;
  onRemove: () => void;
  onCaption: (c: string) => void;
}) {
  const [asset, setAsset] = useState<Asset>();
  useEffect(() => {
    getAsset(clip.assetId).then(setAsset);
  }, [clip.assetId]);

  return (
    <div className={`clip-card ${highlighted ? "highlighted" : ""}`}>
      <AssetImage assetId={clip.assetId} className="clip-thumb" />
      <div className="clip-body">
        {quote ? (
          <div className="clip-quote small" onClick={onShow} title="Show in script">
            “{quote.length > 120 ? quote.slice(0, 120) + "…" : quote}”
          </div>
        ) : (
          <div className="small muted">Not attached to text</div>
        )}
        <input className="caption" placeholder="Caption / note (optional)" value={clip.caption ?? ""} onChange={(e) => onCaption(e.target.value)} />
        {asset && (
          <div className="tiny muted">
            {asset.source.creator && <>{asset.source.creator} · </>}
            {asset.source.license ?? asset.source.provider} · {asset.width}×{asset.height}
            {asset.source.pageUrl && (
              <>
                {" "}
                ·{" "}
                <a href={asset.source.pageUrl} target="_blank" rel="noreferrer">
                  source
                </a>
              </>
            )}
          </div>
        )}
        <div className="row">
          <button className="tiny" onClick={onReanchor} title="Attach to the current selection instead">
            Re-anchor
          </button>
          <button className="tiny ghost" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
