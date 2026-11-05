import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { appleProvider, googleProvider } from "./auth.ts";
import { openDb } from "./db.ts";

const env = process.env;
const production = env.NODE_ENV === "production";

function fatal(message: string): never {
  console.error(`Orator can't start: ${message}`);
  process.exit(1);
}

if (production && !env.DATABASE_URL) fatal("DATABASE_URL is not set (add Heroku Postgres to this app).");
if (production && !env.APP_SECRET) fatal("APP_SECRET is not set (it encrypts users' API keys; generate one with `openssl rand -base64 32`).");

const db = await openDb(
  env.DATABASE_URL ? { url: env.DATABASE_URL } : { dataDir: fileURLToPath(new URL("../.data/pglite", import.meta.url)) },
);

const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? googleProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET) : undefined;
const apple =
  env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
    ? appleProvider({ clientId: env.APPLE_CLIENT_ID, teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, privateKey: env.APPLE_PRIVATE_KEY })
    : undefined;
const allowDevLogin = !production && env.ALLOW_DEV_LOGIN === "1";

if (!google && !apple && !allowDevLogin) console.warn("No sign-in provider is configured: set GOOGLE_CLIENT_ID/SECRET or the APPLE_* vars.");

const app = createApp({
  db,
  secret: env.APP_SECRET ?? "orator-local-development-secret",
  providers: { google, apple },
  allowDevLogin,
  devLoginEmail: env.DEV_LOGIN_EMAIL,
  publicUrl: env.PUBLIC_URL,
  owner: { email: env.ANTHROPIC_KEY_OWNER_EMAIL, serverKey: env.ANTHROPIC_API_KEY },
  staticRoot: production ? fileURLToPath(new URL("../dist", import.meta.url)) : undefined,
  forceHttps: production,
});

const port = Number(env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`Orator listening on port ${port}${production ? " (production)" : ""}; sign-in: ${[google && "google", apple && "apple", allowDevLogin && "dev"].filter(Boolean).join(", ") || "none"}`),
);

// Heroku sends SIGTERM on restarts and deploys; close the database cleanly.
process.on("SIGTERM", () => server.close(() => void db.close().then(() => process.exit(0))));
