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
- refuses to start without `DATABASE_URL` and `APP_SECRET`.

## Accounts

People sign in with Google or Apple. Accounts, linked sign-in identities and sessions live in Postgres (Heroku Postgres in production; PGlite in `web/.data` locally).
AI features run on **each user's own Anthropic API key**, which they paste on the Account page; it's checked with Anthropic, stored AES-256-GCM-encrypted with `APP_SECRET`, and never sent back to the browser (only its last 4 characters).
There is no fallback to a server key, so a stranger who signs in can't spend yours.

**Handing over the server's key:** when the account whose verified email is `ANTHROPIC_KEY_OWNER_EMAIL` signs in and has no key yet, it receives `ANTHROPIC_API_KEY`. After you've signed in on an app, remove both vars from it.

Talks stay in the browser (IndexedDB), now kept separately per account. The first account to sign in on a browser gets a copy of any talks saved there before accounts existed.

## Config vars

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Set automatically by the Heroku Postgres add-on. |
| `APP_SECRET` | yes | `openssl rand -base64 32`. Different per app is fine; **never change it** after users save keys, or their keys become unreadable (they'd need to re-enter them). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in | See below. |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | for Apple sign-in | See below. |
| `PUBLIC_URL` | recommended | The app's canonical origin, e.g. `https://www.orator-ai.com`; sign-in callback URLs are built from it. Without it, the request's host is used. |
| `ANTHROPIC_KEY_OWNER_EMAIL`, `ANTHROPIC_API_KEY` | temporarily | The one-time handover above. |

The old `APP_USERNAME` / `APP_PASSWORD` (site-wide basic auth) are no longer used; remove them.

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

# 3. Database and secrets (repeat for orator-prod)
heroku addons:create heroku-postgresql:essential-0 --app orator-staging
heroku config:set --app orator-staging APP_SECRET="$(openssl rand -base64 32)" PUBLIC_URL=https://orator-staging-xxxx.herokuapp.com
heroku config:set --app orator-staging GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
```

4. Connect GitHub (in the Heroku dashboard; there's no CLI for this step): Pipeline → **Settings** → **Connect to GitHub** → choose the repo.
5. Staging app → **Deploy** → **Automatic deploys** → branch `main`, tick **Wait for CI to pass before deploy** → **Enable Automatic Deploys**.
6. Production gets no automatic deploys. To release, use pipeline → staging card → **Promote to production…**, or:

```sh
heroku pipelines:promote --app orator-staging
```

### Google sign-in

1. [Google Cloud Console](https://console.cloud.google.com/) → create (or pick) a project.
2. **Google Auth Platform** → **Branding**: app name "Orator", support email, and your domains (`orator-ai.com`, `herokuapp.com` for staging). **Audience**: External. Scopes needed: `openid`, `email`, `profile` (no verification review required for these).
3. **Clients** → **Create client** → *Web application*. Authorized redirect URIs (one client can serve all environments):
   - `https://www.orator-ai.com/api/auth/google/callback`
   - `https://orator-staging-xxxx.herokuapp.com/api/auth/google/callback`
   - `http://localhost:5173/api/auth/google/callback` (local, optional)
4. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on each app.

While the Google app is in "Testing" status, only test users you list can sign in; publish it to allow anyone.

### Sign in with Apple

Needs a paid Apple Developer account. Apple only redirects to registered HTTPS domains, so it can't be tested on localhost.

1. **Identifiers** → App ID with *Sign in with Apple* enabled (any bundle ID, e.g. `com.orator-ai.app`; the iPad app will use it too).
2. **Identifiers** → **Services IDs** → new, e.g. `com.orator-ai.web` (this is `APPLE_CLIENT_ID`). Enable *Sign in with Apple* → Configure: primary App ID from step 1; domains `www.orator-ai.com` and `orator-staging-xxxx.herokuapp.com`; return URLs `https://<each domain>/api/auth/apple/callback`.
3. **Keys** → new key with *Sign in with Apple* → download the `.p8` (only once). Its Key ID is `APPLE_KEY_ID`; your Team ID (top right of the developer site) is `APPLE_TEAM_ID`.
4. `heroku config:set --app orator-staging APPLE_CLIENT_ID=com.orator-ai.web APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"`

Apple may give users a private relay address (`…@privaterelay.appleid.com`) instead of their email; such an account won't match an existing Google account by email.

## Checking a deploy

```sh
curl https://orator-staging-xxxx.herokuapp.com/api/health   # {"ok":true}
heroku logs --tail --app orator-staging
```

To roll back production: `heroku releases --app orator-prod`, then `heroku rollback vNN --app orator-prod`.

## Things to know

- **Talks live in the browser.** Scripts and images are stored in the browser's IndexedDB, separately for each site and account. Staging, production and localhost each have their own talks; move a talk between them with **Export .orator** / **Import**. Clearing site data deletes the talks.
  Server-side storage (Postgres plus object storage, since Heroku's filesystem is ephemeral) will be needed for cross-device sync and for the iPad app to pull talks directly.
- **Dictation** uses the browser's speech recognition, which needs HTTPS (fine on Heroku) and, in Chrome, sends audio to Google.
- **Node version:** `engines.node` is `26.x`. If Heroku rejects it, `24.x` also runs the TypeScript server natively.
