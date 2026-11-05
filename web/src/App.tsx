import { useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Workspace } from "./components/Workspace";

function talkIdFromHash() {
  const m = location.hash.match(/^#\/talk\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const [talkId, setTalkId] = useState(talkIdFromHash);

  useEffect(() => {
    const onHash = () => setTalkId(talkIdFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (id: string | null) => {
    location.hash = id ? `#/talk/${encodeURIComponent(id)}` : "";
  };

  return talkId ? <Workspace key={talkId} talkId={talkId} onClose={() => open(null)} /> : <Library onOpen={open} />;
}
