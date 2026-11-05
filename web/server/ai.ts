import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const client = new Anthropic();

// Inline helpers favor speed; structural critique favors depth.
const FAST_MODEL = "claude-sonnet-5-5";
const DEEP_MODEL = "claude-opus-5-5";

const BASE_SYSTEM = `You are a writing partner inside Orator, a tool for writing spoken presentation scripts.
The script is meant to be SPOKEN aloud by the author, not read on slides. Favor short sentences, concrete
language, signposting, and natural spoken rhythm. Preserve the author's voice and claims; never invent facts,
statistics, names, or quotes. When you change text, change only what is needed.`;

export class AiError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

async function structured<T extends z.ZodType>(opts: {
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  prompt: string;
  schema: T;
}): Promise<z.infer<T>> {
  const response = await client.beta.messages.parse({
    model: opts.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: `${BASE_SYSTEM}\n\n${opts.system}`, cache_control: { type: "ephemeral" } }],
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.prompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new AiError("The model declined this request.", 422);
  }
  if (!response.parsed_output) {
    throw new AiError(`Model returned no structured output (stop_reason: ${response.stop_reason}).`);
  }
  return response.parsed_output as z.infer<T>;
}

type Beat = { id: string; text: string; kind?: string; section?: string };

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function renderBeats(beats: Beat[]) {
  return beats
    .map((b) => `<beat id="${attr(b.id)}"${b.kind === "aside" ? ' kind="aside"' : ""}${b.section ? ` section="${attr(b.section)}"` : ""}>\n${b.text}\n</beat>`)
    .join("\n");
}

// ---- Beat helpers (operate on a selection) ----

const HELPER_INSTRUCTIONS: Record<string, string> = {
  tighten: "Tighten the selected text: cut filler and redundancy while keeping every idea.",
  spoken: "Rewrite the selected text so it sounds natural spoken aloud: shorter sentences, plain words, conversational rhythm.",
  transition: "Rewrite the selected text so it opens with a smooth spoken transition from the preceding passage.",
  expand: "Expand the selected text with one or two sentences of elaboration or a concrete example, using only ideas implied by the script.",
  simplify: "Rewrite the selected text for a non-expert listener: replace jargon, add a quick analogy if helpful.",
  hook: "Rewrite the selected text as a stronger attention-grabbing opening (question, surprising contrast, or vivid scene) without inventing facts.",
  tidy:
    "The selected text is raw speech-to-text dictation. Fix punctuation, capitalization and obvious mis-transcriptions; remove filler words (um, uh, you know), false starts and accidental repeats; break it into paragraphs at natural shifts in thought, with a blank line between paragraphs. Keep the speaker's own wording otherwise: do not rewrite, reorder or add ideas.",
};

export const helperActions = Object.keys(HELPER_INSTRUCTIONS);

const HelperResult = z.object({
  replacement: z.string().describe("Text that replaces the selection exactly; plain text, no markdown."),
  rationale: z.string().describe("One sentence explaining the change."),
});

export async function beatHelper(input: { action: string; selection: string; before: string; after: string; instruction?: string }) {
  const instruction = input.action === "custom" ? input.instruction : HELPER_INSTRUCTIONS[input.action];
  if (!instruction) throw new AiError(`Unknown action: ${input.action}`, 400);
  return structured({
    model: FAST_MODEL,
    effort: "low",
    system: "You edit one selected passage of a script at a time.",
    prompt: `Task: ${instruction}\n\n<preceding>\n${input.before}\n</preceding>\n<selection>\n${input.selection}\n</selection>\n<following>\n${input.after}\n</following>`,
    schema: HelperResult,
  });
}

// ---- Reverse outline: one-line point per beat ----

const PointsResult = z.object({
  points: z.array(z.object({ id: z.string(), point: z.string().describe("The beat's main point in at most 12 words.") })),
});

export async function beatPoints(input: { beats: Beat[]; context: Beat[] }) {
  return structured({
    model: FAST_MODEL,
    effort: "low",
    system: "You produce a reverse outline: for each requested beat, state the single point it makes, in at most 12 words. No preamble like 'The speaker says'.",
    prompt: `Full script for context:\n${renderBeats(input.context)}\n\nWrite points for these beat ids only: ${input.beats.map((b) => b.id).join(", ")}`,
    schema: PointsResult,
  });
}

// ---- Suggest sections ----

const SectionsResult = z.object({
  sections: z.array(
    z.object({
      title: z.string().describe("Short section title, 2-5 words."),
      startBeatId: z.string().describe("Id of the first beat in this section."),
      purpose: z.string().describe("What this section does for the listener, one sentence."),
    }),
  ),
  rationale: z.string(),
});

export async function suggestSections(input: { beats: Beat[] }) {
  return structured({
    model: DEEP_MODEL,
    effort: "medium",
    system: "You find the natural section boundaries already present in a script. Do not reorder or rewrite. Sections must be in script order and the first must start at the first beat.",
    prompt: renderBeats(input.beats),
    schema: SectionsResult,
  });
}

// ---- Story coach ----

export const LENSES: Record<string, string> = {
  none: "No particular structure; judge the arc on its own terms.",
  scr: "Situation – Complication – Resolution (Minto): establish shared context, introduce tension, resolve it.",
  "problem-solution": "Problem – Solution – Benefit: make the problem felt, present the solution, show the payoff.",
  "what-is-could-be": "Duarte's sparkline: alternate between 'what is' and 'what could be', ending with a call to a new bliss.",
  hero: "Hero's journey: the audience (not the speaker) is the hero; the speaker is the mentor offering a tool for their journey.",
  "and-but-therefore": "And–But–Therefore: setup, a turning point of conflict, and a consequence that propels forward.",
};

const CoachResult = z.object({
  summary: z.string().describe("2-3 sentences on the talk's current narrative arc."),
  throughline: z.string().describe("The one-sentence big idea the talk seems to be making."),
  strengths: z.array(z.string()),
  issues: z.array(
    z.object({
      beatId: z.string().nullable().describe("Beat the issue is anchored to, or null if global."),
      issue: z.string(),
      suggestion: z.string(),
    }),
  ),
});

export async function storyCoach(input: { beats: Beat[]; lens: string; audience?: string }) {
  const lens = LENSES[input.lens] ?? LENSES.none;
  return structured({
    model: DEEP_MODEL,
    effort: "high",
    system: `You are a story coach for talks. Critique; do not rewrite. Use the lens below as a way of seeing, not a template the author must follow — note where departures from it are working.
Lens: ${lens}
Look for: a clear throughline, a hook, tension or stakes, signposting between ideas, ideas that are asserted but not supported, abrupt jumps, and a memorable close. Keep issues specific and anchored to beats. At most 6 issues.`,
    prompt: `${input.audience ? `Intended audience: ${input.audience}\n\n` : ""}${renderBeats(input.beats)}`,
    schema: CoachResult,
  });
}

// ---- Visual ideas for a passage ----

const VisualIdeasResult = z.object({
  ideas: z.array(
    z.object({
      idea: z.string().describe("What the image would show and why it supports what's being said (one sentence)."),
      queries: z.array(z.string()).describe("1-3 short stock/archive image search queries (2-4 words each)."),
    }),
  ),
});

export async function visualIdeas(input: { passage: string; context: string }) {
  return structured({
    model: FAST_MODEL,
    effort: "low",
    system: `You suggest images to show an audience while the speaker says a passage.
Principles: the image is EVIDENCE or an emotional anchor for what is said — never a picture of the words themselves. Prefer concrete photographs, historical images, diagrams, or a single striking subject. Avoid clichés (handshakes, lightbulbs, puzzle pieces). Give 3 ideas, varied in approach.`,
    prompt: `<context>\n${input.context}\n</context>\n<passage>\n${input.passage}\n</passage>`,
    schema: VisualIdeasResult,
  });
}
