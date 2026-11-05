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

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  hasAnthropicKey: boolean;
  anthropicKeyHint: string | null;
}

export interface Providers {
  google: boolean;
  apple: boolean;
  dev: boolean;
}

/** An API failure; `code` distinguishes e.g. "signed_out", "no_key" and "key_rejected". */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Fired when the server says the session is gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = "orator:signed-out";

async function check(res: Response) {
  if (res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (data.code === "signed_out") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code);
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await check(res)).json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) => send<T>("POST", path, body);

export const api = {
  helper: (b: { action: string; selection: string; before: string; after: string; instruction?: string }) =>
    post<{ replacement: string; rationale: string }>("/ai/helper", b),
  points: (b: { beats: BeatInput[]; context: BeatInput[] }) => post<{ points: { id: string; point: string }[] }>("/ai/points", b),
  sections: (b: { beats: BeatInput[] }) =>
    post<{ sections: { title: string; startBeatId: string; purpose: string }[]; rationale: string }>("/ai/sections", b),
  coach: (b: { beats: BeatInput[]; lens: string; audience?: string }) => post<CoachResult>("/ai/coach", b),
  visualIdeas: (b: { passage: string; context: string }) => post<{ ideas: { idea: string; queries: string[] }[] }>("/ai/visual-ideas", b),
  lenses: () => fetch("/api/ai/lenses").then((r) => r.json() as Promise<Record<string, string>>),
  searchImages: async (q: string) => {
    const res = await check(await fetch(`/api/images/search?q=${encodeURIComponent(q)}`));
    return (await res.json()) as { results: ImageResult[]; errors: string[] };
  },
  me: () => send<{ user: User | null }>("GET", "/me").then((r) => r.user),
  providers: () => send<Providers>("GET", "/auth/providers"),
  setAnthropicKey: (key: string) => send<{ user: User }>("PUT", "/me/anthropic-key", { key }).then((r) => r.user),
  removeAnthropicKey: () => send<{ user: User }>("DELETE", "/me/anthropic-key").then((r) => r.user),
  logout: () => send<{ ok: boolean }>("POST", "/auth/logout"),
};
