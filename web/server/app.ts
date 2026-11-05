import { serveStatic } from "@hono/node-server/serve-static";
import Anthropic from "@anthropic-ai/sdk";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { getAnthropicKey, setAnthropicKey, validateSession, type User } from "./accounts.ts";
import { AiError, beatHelper, beatPoints, clientFor, LENSES, storyCoach, suggestSections, visualIdeas } from "./ai.ts";
import { authRoutes, SESSION_COOKIE, type AuthOptions } from "./auth.ts";
import type { Db } from "./db.ts";
import { fetchImageBytes, searchImages } from "./images.ts";

export interface AppOptions {
  db: Db;
  /** Encrypts users' API keys at rest (APP_SECRET). */
  secret: string;
  providers?: AuthOptions["providers"];
  allowDevLogin?: boolean;
  devLoginEmail?: string;
  publicUrl?: string;
  owner?: AuthOptions["owner"];
  /** Directory of the built web app to serve (production). Omit in dev, where Vite serves it. */
  staticRoot?: string;
  /** Redirect plain-HTTP requests to HTTPS (behind Heroku's router, which sets x-forwarded-proto). */
  forceHttps?: boolean;
  /** Claude client for an API key; tests substitute a fake. */
  claude?: (apiKey: string) => Anthropic;
  /** Rejects keys Anthropic won't accept, before they're saved. */
  verifyKey?: (apiKey: string) => Promise<void>;
}

type Env = { Variables: { user: User | null; claude: Anthropic } };

const defaultVerifyKey = async (apiKey: string) => {
  await clientFor(apiKey).models.list({ limit: 1 });
};

function api(opts: AppOptions) {
  const app = new Hono<Env>();
  const claude = opts.claude ?? clientFor;
  const verifyKey = opts.verifyKey ?? defaultVerifyKey;

  app.onError((err, c) => {
    if (err instanceof AiError) return c.json({ error: err.message }, err.status as 400);
    // A 401 from Anthropic means the user's key is bad, not that they're signed out of Orator.
    if (err instanceof Anthropic.AuthenticationError) {
      return c.json({ error: "Anthropic rejected your API key. Update it in Account settings.", code: "key_rejected" }, 400);
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return c.json({ error: "Your Anthropic API key doesn't have access to this model.", code: "key_rejected" }, 400);
    }
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: "Rate limited by the Claude API; try again shortly." }, 429);
    console.error(err);
    if (err instanceof Anthropic.APIError) return c.json({ error: `Claude API error ${err.status}: ${err.message}` }, 502);
    return c.json({ error: err.message }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Cross-site requests can't change anything: browsers always send Origin on POST/PUT/DELETE.
  // Apple's sign-in callback is the one legitimate cross-site POST (its own state check protects it).
  app.use("*", async (c, next) => {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    const origin = c.req.header("origin");
    if (unsafe && origin && c.req.path !== "/api/auth/apple/callback") {
      let host: string | undefined;
      try {
        host = new URL(origin).host;
      } catch {
        /* invalid origin */
      }
      if (host !== (c.req.header("host") ?? new URL(c.req.url).host)) return c.json({ error: "Cross-site request blocked" }, 403);
    }
    await next();
  });

  app.use("*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    c.set("user", token ? await validateSession(opts.db, token) : null);
    await next();
  });

  app.route("/auth", authRoutes({ ...opts, providers: opts.providers ?? {} }));

  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    if (!c.get("user")) return c.json({ error: "Please sign in.", code: "signed_out" }, 401);
    await next();
  };

  // ---- Account ----
  app.get("/me", (c) => c.json({ user: c.get("user") }));

  app.put("/me/anthropic-key", requireUser, async (c) => {
    const { key } = (await c.req.json().catch(() => ({}))) as { key?: unknown };
    const trimmed = typeof key === "string" ? key.trim() : "";
    if (!trimmed) return c.json({ error: "Paste an Anthropic API key." }, 400);
    try {
      await verifyKey(trimmed);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return c.json({ error: "Anthropic didn't accept that key. Check it and try again." }, 400);
      throw e;
    }
    return c.json({ user: await setAnthropicKey(opts.db, c.get("user")!.id, trimmed, opts.secret) });
  });

  app.delete("/me/anthropic-key", requireUser, async (c) => c.json({ user: await setAnthropicKey(opts.db, c.get("user")!.id, null, opts.secret) }));

  // ---- AI (on the user's own key) ----
  app.get("/ai/lenses", (c) => c.json(LENSES));
  app.use("/ai/*", requireUser);
  app.use("/ai/*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));
  app.use("/ai/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const key = await getAnthropicKey(opts.db, c.get("user")!.id, opts.secret);
    if (!key) return c.json({ error: "Add your Anthropic API key in Account settings to use AI features.", code: "no_key" }, 403);
    c.set("claude", claude(key));
    await next();
  });
  app.post("/ai/helper", async (c) => c.json(await beatHelper(c.get("claude"), await c.req.json())));
  app.post("/ai/points", async (c) => c.json(await beatPoints(c.get("claude"), await c.req.json())));
  app.post("/ai/sections", async (c) => c.json(await suggestSections(c.get("claude"), await c.req.json())));
  app.post("/ai/coach", async (c) => c.json(await storyCoach(c.get("claude"), await c.req.json())));
  app.post("/ai/visual-ideas", async (c) => c.json(await visualIdeas(c.get("claude"), await c.req.json())));

  // ---- Images ----
  app.use("/images/*", requireUser);
  app.get("/images/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ results: [], errors: [] });
    const providers = (c.req.query("providers") ?? "openverse,wikimedia").split(",");
    return c.json(await searchImages(q, providers));
  });

  app.get("/images/fetch", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ error: "url required" }, 400);
    try {
      const { type, buf } = await fetchImageBytes(url);
      return c.body(buf, 200, { "Content-Type": type, "Cache-Control": "private, max-age=3600" });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.all("*", (c) => c.json({ error: "Not found" }, 404));
  return app;
}

export function createApp(opts: AppOptions) {
  const app = new Hono();

  if (opts.forceHttps) {
    app.use("*", async (c, next) => {
      if (c.req.header("x-forwarded-proto") === "http") {
        const url = new URL(c.req.url);
        url.protocol = "https:";
        return c.redirect(url.toString(), 301);
      }
      await next();
    });
  }

  app.use("*", secureHeaders({ crossOriginEmbedderPolicy: false }));

  app.route("/api", api(opts));

  if (opts.staticRoot) {
    const root = opts.staticRoot;
    // Hashed build assets never change; everything else (index.html) must revalidate so deploys take effect.
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.status === 200) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}
