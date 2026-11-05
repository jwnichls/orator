import { serveStatic } from "@hono/node-server/serve-static";
import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { AiError, beatHelper, beatPoints, LENSES, storyCoach, suggestSections, visualIdeas } from "./ai.ts";
import { fetchImageBytes, searchImages } from "./images.ts";

export interface AppOptions {
  /** Directory of the built web app to serve (production). Omit in dev, where Vite serves it. */
  staticRoot?: string;
  /** When set, every route except /api/health requires HTTP basic auth. */
  auth?: { username: string; password: string };
  /** Redirect plain-HTTP requests to HTTPS (behind Heroku's router, which sets x-forwarded-proto). */
  forceHttps?: boolean;
}

const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

function api() {
  const app = new Hono();

  app.onError((err, c) => {
    console.error(err);
    if (err instanceof AiError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof Anthropic.AuthenticationError) {
      return c.json({ error: "Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY on the server." }, 401);
    }
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: "Rate limited by the Claude API; try again shortly." }, 429);
    if (err instanceof Anthropic.APIError) return c.json({ error: `Claude API error ${err.status}: ${err.message}` }, 502);
    return c.json({ error: err.message }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true, ai: aiConfigured() }));

  app.get("/ai/lenses", (c) => c.json(LENSES));
  app.use("/ai/*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));
  app.use("/ai/*", async (c, next) => {
    if (c.req.method === "POST" && !aiConfigured()) {
      return c.json({ error: "AI is offline: set ANTHROPIC_API_KEY on the server and restart it." }, 503);
    }
    await next();
  });
  app.post("/ai/helper", async (c) => c.json(await beatHelper(await c.req.json())));
  app.post("/ai/points", async (c) => c.json(await beatPoints(await c.req.json())));
  app.post("/ai/sections", async (c) => c.json(await suggestSections(await c.req.json())));
  app.post("/ai/coach", async (c) => c.json(await storyCoach(await c.req.json())));
  app.post("/ai/visual-ideas", async (c) => c.json(await visualIdeas(await c.req.json())));

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

export function createApp(opts: AppOptions = {}) {
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

  app.use("*", secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: undefined }));

  if (opts.auth) {
    const guard = basicAuth({ ...opts.auth, realm: "Orator" });
    app.use("*", async (c, next) => (c.req.path === "/api/health" ? next() : guard(c, next)));
  }

  app.route("/api", api());

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
