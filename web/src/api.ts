export interface ImageResult {
  provider: "openverse" | "wikimedia";
  id: string;
  title: string;
  thumbUrl: string;
  url: string;
  pageUrl?: string;
  creator?: string;
  license?: string;
  licenseUrl?: string;
  width?: number;
  height?: number;
}

export type BeatInput = { id: string; text: string; kind?: string; section?: string };

export interface CoachResult {
  summary: string;
  throughline: string;
  strengths: string[];
  issues: { beatId: string | null; issue: string; suggestion: string }[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  helper: (b: { action: string; selection: string; before: string; after: string; instruction?: string }) =>
    post<{ replacement: string; rationale: string }>("/ai/helper", b),
  points: (b: { beats: BeatInput[]; context: BeatInput[] }) => post<{ points: { id: string; point: string }[] }>("/ai/points", b),
  sections: (b: { beats: BeatInput[] }) =>
    post<{ sections: { title: string; startBeatId: string; purpose: string }[]; rationale: string }>("/ai/sections", b),
  coach: (b: { beats: BeatInput[]; lens: string; audience?: string }) => post<CoachResult>("/ai/coach", b),
  visualIdeas: (b: { passage: string; context: string }) => post<{ ideas: { idea: string; queries: string[] }[] }>("/ai/visual-ideas", b),
  lenses: () => fetch("/api/ai/lenses").then((r) => r.json() as Promise<Record<string, string>>),
  health: () => fetch("/api/health").then((r) => r.json() as Promise<{ ok: boolean; ai: boolean }>),
  searchImages: async (q: string) => {
    const res = await fetch(`/api/images/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return (await res.json()) as { results: ImageResult[]; errors: string[] };
  },
};
