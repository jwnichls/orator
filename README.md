# Orator

A script-first presentation tool. You write what you'll *say*. Visual content is gathered and anchored to the words
it supports. Later, the script is shaped into one or more presentation variants and delivered from an iPad.

- `docs/research-synthesis.md`: related research and the design principles drawn from it
- `docs/plan.md`: workflow (Write → Gather → Shape), data model, and phased plan
- `docs/deployment.md`: GitHub + Heroku pipeline (auto-deploy to staging, promote to production)
- `web/`: authoring web app (Phase 1: Write + Gather)

## Running the web app

Requires Node 26. From the project root:

```sh
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY (.env is git-ignored)
npm run dev            # API on :8787, app on http://localhost:5173
```

Without a key, writing and image search still work and the AI features are disabled.

## Tests

```sh
npm test              # all tests (Vitest): server in Node, web app in jsdom
npm run check         # typecheck + lint + tests, as CI runs them
npm run test:watch -w web
```

- `web/server/*.test.ts`: API routes, error mapping, auth/HTTPS/static serving, Claude request shapes (SDK mocked), image search and the image proxy's private-network guard.
- `web/src/**/*.test.ts(x)`: derivation, editor extensions, IndexedDB storage and `.orator` bundles (fake-indexeddb), dictation (fake speech recognizer), and components with the API client mocked.

No test calls Claude or the image providers for real.

## What's in Phase 1

- **Script editor:** one paragraph per beat. Sections (§) are optional headings. Asides are optional material.
- **Dictation:** 🎙 Dictate speaks your script in at the cursor (browser speech recognition; say "new paragraph" to break). Afterwards, "Tidy it up" fixes punctuation, removes filler words and adds paragraph breaks, and comes back as a reviewable diff.
- **Live outline:** each paragraph gets a one-line point (a reverse outline). "Suggest sections" proposes boundaries from the script.
- **Writing helpers:** select text to get Tighten / Make spoken / Simplify / Expand / Transition / Hook / Ask…. Each comes back as a reviewable diff.
- **Story coach:** critiques the narrative arc, optionally through a lens (SCR, And–But–Therefore, …).
- **Gather:** "Images" on a passage suggests what could support it, then searches Openverse and Wikimedia Commons, or you can upload your own. Images are downloaded and stored locally (IndexedDB, keyed by SHA-256), with source and license kept.
- **Export `.orator`:** a self-contained zip (`talk.json`, `assets.json`, `assets/<sha256>.<ext>`) that the iPad app will import for offline presenting.

## Code map (web/)

- `server/`: Hono API. `app.ts` (routes, auth, static serving), `ai.ts` (Claude: structured outputs), `images.ts` (search + byte proxy), `index.ts` (entry point)
- `src/model/`: types, IndexedDB store, bundle export/import, derivation of beats and sections from the editor doc
- `src/editor/`: TipTap extensions (stable beat ids, asides, `clip` anchor marks), shared commands, dictation
- `test/`: shared test setup and helpers (editor builder, fake speech recognizer)
- `src/components/`: Library, Workspace, LeftPane (outline/coach), ScriptEditor, ContentPane (find/gathered)
