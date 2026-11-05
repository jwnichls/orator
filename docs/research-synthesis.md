# Orator — Research Synthesis

The concept: a presentation tool built around a **spoken script**. The visuals shown to the audience are
*cues anchored to spans of that script*. Optional side content (asides, backup material, presenter-only
notes) sits alongside the main line. Authoring happens on the web with LLM help for narrative,
script and visual-finding. Delivery happens on a native iPad app.

## 1. Literature by theme

### A. Narrative-first presentation authoring
| Work | Key idea | Implication for Orator |
|---|---|---|
| **HyperSlides** (Edge, Savage, Yatani — CHI 2013) | Author a hierarchical markup outline; slides are generated from it. Faster organization, but less layout control. | The outline/script is the source of truth. Layout comes from it. |
| **TurningPoint** (Pschetz, Yatani, Edge — CHI 2014, HM) | Narrative templates in slideware. They **save time by focusing attention, but can fixate authors and limit experimentation.** Slides often come at the expense of storytelling. | Offer story structures as *optional, swappable lenses*, not forms to fill in. Make switching structure cheap. |
| **SlideSpace** (Edge et al. — CHI 2016) | Hybrid slide/canvas generated from an outline. | A spatial "overview map" of the talk is useful alongside linear flow. |
| **TalkZones** (MobileHCI 2014) | Section-based time targets. Mean overrun was 8 s vs. 1 m 49 s with a regular timer. | Give each section a time budget, estimate duration from the script, and show zone timing on the iPad. |
| **ReSlide / "When Constraints Limit and Inspire"** (Waterloo, 2026) | Experienced presenters prioritize **time, audience, communicative intent**. Talks evolve and get reused across venues. | Make these three constraints first-class project settings. Support versions/variants of a talk (the 10-min vs. 30-min cut). |
| **OutlineSpark** (CHI 2024), **Slide4N** (CHI 2023), **NB2Slides** (CHI 2022) | Outline-driven AI slide generation. Users preferred outlines because it **matched their practice and let them focus on narrative.** | Outline ↔ script ↔ cues should be a single linked structure. |

### B. LLM writing assistance (structure, not only text)
| Work | Key idea | Implication |
|---|---|---|
| **Script&Shift** (Siddiqui, Pea, Subramonyam — CHI 2025) | Layered workspace that separates *content development* ("scripting") from *rhetorical reorganization for an audience* ("shifting"). Inline specialist helpers ("Writer's Friends"). Beat chat interfaces for knowledge transformation. | Two modes: **Write** (draft beats) and **Shape** (reorder and re-target for an audience). Use inline, scoped helpers instead of one chat box. |
| **Dang et al.** (UIST 2022) — continuous automatic summaries | Per-paragraph summaries act as a live **reverse outline** that supports revision. | Auto-generate a one-line "point" for each beat. The outline view is derived from the script and stays in sync. |
| **Intent Tagging** (2025), **ECHO** (2026) | Granular, explainable micro-edits instead of wholesale regeneration. | Every AI change is a reviewable diff on a specific span, with a rationale. |
| Co-writing scaffolding studies (2024–25) | Novices benefit from more scaffolding; experts want less. | Adjustable proactivity (see Visual Captions below). |

### C. What should be on the screen
| Work | Key idea | Implication |
|---|---|---|
| **Mayer, multimedia learning** — redundancy, coherence, signaling, contiguity | Narration plus graphics beats narration plus graphics plus the same text. Remove extraneous material. Visuals should appear *when* the matching words are spoken. | This is the core argument for the product: script in the presenter's mouth, visuals on screen, timed to the words. A linter flags cues that just restate the script. |
| **Assertion–evidence** (Garner & Alley, IJEE 2013 and others) | Sentence-headline assertion plus visual evidence improves comprehension of complex concepts. Effects are mixed but positive, and authors also understood their own content better. | Default cue template: *assertion + evidence visual*. The LLM can propose the assertion from the script span. |
| **Kosslyn et al.** (Frontiers 2012) | Violations of 8 perceptual and cognitive principles are pervasive. Audiences notice them, but authors can't spot them. | Automated design critique is valuable because authors are bad at self-diagnosis. |
| **Segel & Heer** (InfoVis 2010) | Narrative visualization genres and tactics (annotation, progressive reveal, highlighting). | Cue types should include *builds/reveals* and *annotated charts*, not just static images. |

### D. Speech-coupled delivery
| Work | Key idea | Implication |
|---|---|---|
| **RealityTalk** (Liao et al. — UIST 2022) | Real-time speech recognition plus keyword extraction triggers visual elements during a live talk. | Speech-following is feasible. Anchors on script words can fire cues automatically. |
| **Visual Captions** (Liu, Du et al. — CHI 2023) | LLM proactively suggests visuals from conversation, at **three proactivity levels** (auto-display, auto-suggest, on-demand). Lab N=26, deployment N=10. | Use the same 3 levels for visual suggestions in authoring, and for cue-firing during delivery (auto / confirm / manual). |
| **Trinity** (Chinese CHI 2024) | LLM script refinement plus a speech-synchronized smart prompter. | Validates script-plus-prompter delivery. iPad teleprompter view follows speech. |
| **Augmented Chironomia** (UIST 2022) | Gesture-driven highlighting of data visuals. | Future work: touch/Pencil gestures on the iPad to highlight parts of a visual. |
| **DeepSlide** (arXiv 2026) | Time-budgeted narrative planning, aligned slide–script generation, and rehearsal support. Biggest gains are in *delivery* metrics such as flow, pacing and slide–script alignment. | Confirms the direction: optimize the *delivered talk*, not the deck as an artifact. |
| **PPTAgent** (EMNLP 2025), **DocPres** (INLG 2024), **PASS** (2025) | End-to-end doc→slides generation with content/design/coherence evaluation (PPTEval). | Useful evaluation rubrics. We are deliberately *not* building one-shot generation. |

### E. Rehearsal and audience modeling
| Work | Key idea | Implication |
|---|---|---|
| **Rhema** (IUI 2015) | Real-time pace and volume feedback. **Sparse** feedback was preferred over continuous. | Rehearsal feedback on the iPad should be sparse and glanceable. |
| **AudiLens**, **SimTube**, **PresentCoach** (2023–25) | LLM-simulated audience personas give feedback on comprehension and engagement. | "Audience lens": run the script past personas (novice, expert, skeptic) and annotate where each gets lost. |

## 2. Synthesized design principles

1. **The script is the spine.** Everything else (visuals, notes, timing, outline) is anchored to spans of spoken text. *(HyperSlides, Mayer contiguity, RealityTalk)*
2. **Say it, don't show it twice.** Screen content is *evidence* for what's being said, not a transcript. Flag redundancy. *(Mayer redundancy, assertion-evidence, Kosslyn)*
3. **Structure is a lens, not a cage.** Narrative templates are optional overlays that can be swapped and that critique, not dictate. *(TurningPoint)*
4. **Live reverse outline.** Each beat gets an auto-summarized "point", so the narrative arc is always visible and editable at the structure level. *(Dang et al., Script&Shift)*
5. **Constraints first.** Time, audience and intent are set at the start and drive time budgets, vocabulary and the audience lens. *(ReSlide, TalkZones)*
6. **Granular, reviewable AI.** Suggestions are scoped to a selection, shown as diffs with rationales, and the user sets the proactivity level. *(Visual Captions, Intent Tagging, ECHO)*
7. **Optimize delivery.** Duration estimates, section budgets, a speech-following teleprompter and sparse rehearsal feedback. *(DeepSlide, TalkZones, Rhema, Trinity)*
8. **Side content is first-class.** Asides, backup slides, "if time permits" branches and Q&A material are attached to the main line but skipped by default. *(HyperSlides' hyperlinked scenes, ReSlide's multi-length variants)*

## Sources
- HyperSlides — https://www.microsoft.com/en-us/research/?p=164668
- TurningPoint — https://www.microsoft.com/en-us/research/publication/turningpoint-narrative-driven-presentation-planning/
- SlideSpace — https://www.microsoft.com/en-us/research/publication/slidespace-heuristic-design-hybrid-presentation-medium/
- TalkZones — https://www.microsoft.com/en-us/research/?p=166941
- When Constraints Limit and Inspire — https://arxiv.org/pdf/2604.21205 ; ReSlide thesis — https://uwspace.uwaterloo.ca/items/11105917-2693-490b-9c5d-475aa441ec89
- OutlineSpark — https://arxiv.org/html/2403.09121v1
- Script&Shift — https://www.arxiv.org/abs/2502.10638
- Papers-to-Posts (cites Dang et al. reverse outlines) — https://arxiv.org/pdf/2406.10370
- Intent Tagging — https://arxiv.org/pdf/2502.18737 ; ECHO — https://arxiv.org/pdf/2606.09851
- Kosslyn et al. 2012 — https://www.frontiersin.org/articles/10.3389/fpsyg.2012.00230/full
- Garner & Alley 2013 — https://www.ijee.ie/articles/Vol29-6/23_ijee2791ns.pdf ; Penn State research summary — https://writing.engr.psu.edu/research.html
- Segel & Heer 2010 — https://idl.uw.edu/papers/narrative
- RealityTalk — https://arxiv.org/pdf/2208.06350
- Visual Captions — https://research.google/pubs/visual-captions-augmenting-verbal-communication-with-on-the-fly-visuals/
- Trinity — https://arxiv.org/pdf/2411.17015
- Augmented Chironomia — https://www.tableau.com/research/publications/augmented-chironomia-presenting-data-remote-audiences
- DeepSlide — https://arxiv.org/pdf/2605.15202
- PPTAgent — https://arxiv.org/abs/2501.03936v3 ; DocPres — https://aclanthology.org/2024.inlg-main.18/ ; PASS — https://arxiv.org/html/2501.06497v2
- Rhema — https://www.hoques.com/Publications/2015/2015-Rhema-IUI-Tanveer-Lin-Hoque.pdf
- AudiLens — https://www.semanticscholar.org/paper/AudiLens:-Configurable-LLM-Generated-Audiences-for-Park-Choi/e478ac94dda7a4180036965930efc8d4c8f4f4af ; SimTube — https://dl.acm.org/doi/10.1145/3708359.3712146 ; PresentCoach — https://arxiv.org/pdf/2511.15253

*Caveat:* Several entries were verified only through abstracts and search snippets (noted inline where results conflicted). Read the full papers before citing them formally.
