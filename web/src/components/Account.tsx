import { useState } from "react";
import { api, type User } from "../api";

export function Account({ user, onUser, onSignOut, onClose }: { user: User; onUser: (u: User) => void; onSignOut: () => void; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      onUser(await api.setAnthropicKey(key));
      setKey("");
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    setSaved(false);
    try {
      onUser(await api.removeAnthropicKey());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="account">
      <header className="topbar">
        <button className="ghost" onClick={onClose}>
          ← Talks
        </button>
        <strong>Account</strong>
        <div className="spacer" />
        <button onClick={onSignOut}>Sign out</button>
      </header>

      <div className="account-body">
        <section className="card account-profile">
          {user.avatarUrl ? <img className="avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <div className="avatar">{initials(user)}</div>}
          <div>
            <div>
              <strong>{user.name ?? "Signed in"}</strong>
            </div>
            {user.email && <div className="muted small">{user.email}</div>}
          </div>
        </section>

        <section className="card">
          <h2>Anthropic API key</h2>
          <p className="small muted">
            Orator's AI features (writing help, the outline, the story coach, image ideas) run on your own Claude API key, billed to your Anthropic account. Create one in the{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              Anthropic Console
            </a>
            . It's stored encrypted on the server and only used for your requests.
          </p>
          {user.hasAnthropicKey ? (
            <div className="row">
              <span className="key-status ok">Key saved, ending in …{user.anthropicKeyHint}</span>
              <button className="small ghost" disabled={!!busy} onClick={remove}>
                {busy === "remove" ? "Removing…" : "Remove"}
              </button>
            </div>
          ) : (
            <div className="key-status">No key yet: AI features are off.</div>
          )}
          <form className="row key-form" onSubmit={save}>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={user.hasAnthropicKey ? "Replace with a new key (sk-ant-…)" : "Paste your key (sk-ant-…)"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label="Anthropic API key"
            />
            <button className="primary" type="submit" disabled={!key.trim() || !!busy}>
              {busy === "save" ? "Checking…" : "Save key"}
            </button>
          </form>
          {saved && <p className="small ok-text">Key checked with Anthropic and saved.</p>}
          {error && <p className="error small">{error}</p>}
        </section>
      </div>
    </div>
  );
}

function initials(u: User) {
  const source = u.name ?? u.email ?? "?";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
