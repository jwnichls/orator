# Orator — Product & Build Plan

See `research-synthesis.md` for the reasoning behind each principle cited here (P1–P8).

## Workflow: three stages

1. **Write.** Free-form script writing. The author does not have to think about the final presentation: no timing, no layouts, no audience-screen preview. Sections are optional. The author can create them by hand, or the system can propose them from the script (reverse outline, P4).
2. **Gather.** Content finding. While writing or afterwards, the author attaches candidate content to spans of the script. The system helps find images that support a passage. Gathered content is a *library linked to the script*, not yet placed into a presentation.
3. **Shape.** Refinement into one or more **presentation variants** (e.g., "10-min lightning", "45-min keynote"). Each variant chooses which beats are included, sets timing constraints and section budgets, turns gathered content into cues with layouts and triggers, and gets a preview of the audience screen. Linting (redundancy, overload) lives here.

Visual types: **images only to start.** Later: data-driven figures and visualizations (the user provides data, and the system helps design charts), quotes, assertion–evidence cards, video and progressive reveals.

## Core data model

```
Talk
 ├─ title, notes
 ├─ beats[]                 ordered paragraphs of spoken script (rich text)
 │    ├─ id, text (ProseMirror JSON), point? (auto one-liner)
 │    ├─ sectionId?         sections are optional groupings
 │    └─ kind               "main" | "aside"
 ├─ sections[]              { id, title }   (manual, or proposed by the AI)
 ├─ clips[]                 gathered content, anchored to the script
 │    { id, anchor: {beatId, quote}, assetId, caption?, note? }
 ├─ assets[]                { id, kind:"image", mime, sha256, width, height,
 │                            source{provider, url, author, license} }  binary stored locally
 └─ variants[]              (Stage 3)
      { id, name, constraints{durationMin, audience, intent},
        includedBeats, cues[ {clipId|assetId, anchor, trigger, layout} ] }
```

### Offline guarantee
- When an asset is attached, its **bytes are downloaded and stored** (server proxy fetch, then an IndexedDB blob, content-addressed by sha256). Remote URLs are kept only as provenance and are never used for display.
- **Export** writes an `.orator` bundle (zip): `talk.json` plus `assets/<sha256>.<ext>`. The iPad app imports bundles and keeps everything on-device, so it can present with no network.
- Later: a sync endpoint on the Node server. The iPad pulls `talk.json` and any assets it doesn't already have (by hash), then works offline.

## Phase 1 — Write + Gather (web)
**Stack:** Vite + React + TypeScript. TipTap/ProseMirror editor. A Node (Hono) server proxying the Claude API (`claude-sonnet-5-5` for inline helpers, `claude-opus-5-5` for structural critique) and image search (Openverse + Wikimedia Commons). Local-first storage in IndexedDB. `.orator` export/import.

UI:
- **Script pane (center):** a distraction-free editor, one paragraph per beat, with optional section headings. Selecting text offers AI helpers and "Find images".
- **Outline pane (left, collapsible):** a live reverse outline (beat points), sections, and a "Suggest sections" button.
- **Content pane (right):** clips for the current beat or selection, image search results, and gathered content for the whole talk.

AI in Phase 1 (scoped, diff-based, with a rationale; P6):
- Beat helpers on a selection: tighten, make it more spoken, add a transition, expand, and simplify.
- Story coach: critique the narrative arc. An optional lens (SCR, problem–solution, hero's journey...) gives *critique only*, never a forced template (P3).
- Suggest sections from the script.
- Visual ideas: for a passage, propose what an image could show and generate search queries, then run the search.

## Phase 2 — Shape (web)
Variants, constraints and timing (~140 wpm estimates, section budgets), cue placement from clips, an audience-screen preview, the linter, and an audience-persona lens.

## Phase 3 — iPad delivery (SwiftUI)
Bundle import/sync and fully offline presentation. A teleprompter presenter view, a second-screen audience view, speech-following cue triggers, and rehearsal mode.

## Phase 4 — Data visuals
The user supplies data (CSV/paste). The system proposes chart forms tied to the claim being made in the script (assertion → evidence), rendered to both web and iPad (likely a Vega-Lite spec, with a rendered PNG fallback in the bundle).
