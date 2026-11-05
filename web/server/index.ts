import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";

const production = process.env.NODE_ENV === "production";
const { APP_USERNAME, APP_PASSWORD } = process.env;

if (production && !(APP_USERNAME && APP_PASSWORD)) {
  console.warn("APP_USERNAME/APP_PASSWORD are not set: the app and its Claude proxy are open to anyone with the URL.");
}

const app = createApp({
  staticRoot: production ? fileURLToPath(new URL("../dist", import.meta.url)) : undefined,
  auth: APP_USERNAME && APP_PASSWORD ? { username: APP_USERNAME, password: APP_PASSWORD } : undefined,
  forceHttps: production,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`Orator listening on http://localhost:${port}${production ? " (production)" : ""}`));
