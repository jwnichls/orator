# Deployment (GitHub → Heroku)

One Heroku app serves both the API and the built web app (`web: node web/server/index.ts`). Two apps share a Heroku pipeline:

| App | Deploys | How |
| --- | --- | --- |
| staging | automatically, on every push to `main` that passes CI | GitHub integration, "Wait for CI to pass" |
| production | manually | "Promote to production" in the pipeline (the exact slug tested on staging, no rebuild) |

## What's in the repo

- `package.json` (root): npm workspace containing `web/`; pins Node `26.x` (Node runs the server's TypeScript directly, so the server needs no build step).
  Heroku runs `npm ci`, then `npm run build` (Vite builds `web/dist`), then prunes dev dependencies.
- `Procfile`: `web: node web/server/index.ts`.
- `app.json`: buildpack and config-var descriptions (also used if you turn on review apps).
- `.github/workflows/ci.yml`: typecheck, lint, tests and build on every push and pull request.

In production (`NODE_ENV=production`, set by Heroku), the server:
- serves `web/dist`, with long-lived caching for hashed assets only;
- redirects HTTP to HTTPS;
- requires HTTP basic auth on everything except `/api/health` when `APP_USERNAME` and `APP_PASSWORD` are set.

## Config vars

| Var | Required | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Without it the app works but AI features are disabled. Consider a separate key per app so usage is visible separately. |
| `APP_USERNAME`, `APP_PASSWORD` | strongly recommended | The server proxies your Claude key and fetches images; without a login, anyone with the URL can spend your key. |

## One-time setup

Replace `orator-staging` / `orator-prod` with your app names (they must be globally unique).

```sh
# 1. GitHub repo (from the project root)
git add -A && git commit -m "Initial commit"
gh repo create <you>/orator --private --source . --push

# 2. Heroku apps and pipeline
heroku create orator-staging
heroku create orator-prod
heroku pipelines:create orator --app orator-staging --stage staging
heroku pipelines:add orator --app orator-prod --stage production

# 3. Config (repeat for orator-prod with its own values)
heroku config:set --app orator-staging ANTHROPIC_API_KEY=... APP_USERNAME=... APP_PASSWORD=...
```

4. Connect GitHub (in the Heroku dashboard; there's no CLI for this step): Pipeline → **Settings** → **Connect to GitHub** → choose the repo.
5. Staging app → **Deploy** → **Automatic deploys** → branch `main`, tick **Wait for CI to pass before deploy** → **Enable Automatic Deploys**.
6. Production gets no automatic deploys. To release, use pipeline → staging card → **Promote to production…**, or:

```sh
heroku pipelines:promote --app orator-staging
```

## Checking a deploy

```sh
curl https://orator-staging-xxxx.herokuapp.com/api/health   # {"ok":true,"ai":true}
heroku logs --tail --app orator-staging
```

To roll back production: `heroku releases --app orator-prod`, then `heroku rollback vNN --app orator-prod`.

## Things to know

- **Talks live in the browser.** Scripts and images are stored in the browser's IndexedDB, separately for each site. Staging, production and localhost each have their own talks; move a talk between them with **Export .orator** / **Import**. Clearing site data deletes the talks.
  Server-side storage (Postgres plus object storage, since Heroku's filesystem is ephemeral) will be needed for cross-device sync and for the iPad app to pull talks directly.
- **Dictation** uses the browser's speech recognition, which needs HTTPS (fine on Heroku) and, in Chrome, sends audio to Google.
- **Node version:** `engines.node` is `26.x`. If Heroku rejects it, `24.x` also runs the TypeScript server natively.
