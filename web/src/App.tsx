import { useCallback, useEffect, useState } from "react";
import { api, SIGNED_OUT_EVENT, type Providers, type User } from "./api";
import { Account } from "./components/Account";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";
import { setStoreUser } from "./model/store";

type Route = { name: "library" } | { name: "talk"; id: string } | { name: "account" };

function routeFromHash(): Route {
  if (location.hash === "#/account") return { name: "account" };
  const m = location.hash.match(/^#\/talk\/(.+)$/);
  return m ? { name: "talk", id: decodeURIComponent(m[1]) } : { name: "library" };
}

/** Sign-in errors come back from the server as ?auth_error=…; show once, then clean the URL. */
function takeAuthError() {
  const params = new URLSearchParams(location.search);
  const error = params.get("auth_error");
  if (error) history.replaceState(null, "", location.pathname + location.hash);
  return error;
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [authError] = useState(takeAuthError);
  const [storeReady, setStoreReady] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadMe = useCallback(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    loadMe();
    api.providers().then(setProviders).catch(() => setProviders({ google: false, apple: false, dev: false }));
    const onSignedOut = () => setUser(null);
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [loadMe]);

  // Each account has its own local database; open it before showing any talks.
  useEffect(() => {
    if (!user) return;
    let live = true;
    setStoreUser(user.id).then(() => live && setStoreReady(user.id));
    return () => {
      live = false;
    };
  }, [user]);

  const go = (hash: string) => {
    location.hash = hash;
  };

  const signOut = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    go("");
  };

  if (user === undefined || (user && storeReady !== user.id)) return <div className="loading">Loading…</div>;
  if (!user) return <Login providers={providers} error={authError} />;

  if (route.name === "account") return <Account user={user} onUser={setUser} onSignOut={signOut} onClose={() => go("")} />;
  if (route.name === "talk") return <Workspace key={route.id} talkId={route.id} onClose={() => go("")} aiAvailable={user.hasAnthropicKey} />;
  return <Library user={user} onOpen={(id) => go(`#/talk/${encodeURIComponent(id)}`)} />;
}
