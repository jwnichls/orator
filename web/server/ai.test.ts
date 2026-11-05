import { beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { parse } };
  },
}));

const { AiError, beatHelper, beatPoints, helperActions, renderBeats, storyCoach, suggestSections, visualIdeas, LENSES } = await import("./ai.ts");

const ok = (parsed_output: unknown) => ({ stop_reason: "end_turn", parsed_output });
const lastRequest = () => parse.mock.calls.at(-1)![0];

beforeEach(() => parse.mockReset());

describe("structured requests", () => {
  it("sends the cached system prompt, server-side fallback and effort", async () => {
    parse.mockResolvedValue(ok({ replacement: "x", rationale: "y" }));
    await beatHelper({ action: "tighten", selection: "s", before: "", after: "" });
    const req = lastRequest();
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.fallbacks).toBe("default");
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.system[0].text).toMatch(/SPOKEN aloud/);
    expect(req.output_config.effort).toBe("low");
    expect(req.output_config.format).toBeDefined();
    expect(req).not.toHaveProperty("thinking");
  });

  it("maps a refusal to a 422 AiError", async () => {
    parse.mockResolvedValue({ stop_reason: "refusal", parsed_output: null });
    const err = await beatHelper({ action: "tighten", selection: "s", before: "", after: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.status).toBe(422);
  });

  it("errors when no structured output comes back", async () => {
    parse.mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    await expect(beatPoints({ beats: [], context: [] })).rejects.toThrow(/max_tokens/);
  });
});

describe("beatHelper", () => {
  it("uses the fast model and puts the selection between its context", async () => {
    parse.mockResolvedValue(ok({ replacement: "r", rationale: "why" }));
    const res = await beatHelper({ action: "spoken", selection: "SELECTED", before: "BEFORE", after: "AFTER" });
    expect(res).toEqual({ replacement: "r", rationale: "why" });
    const req = lastRequest();
    expect(req.model).toBe("claude-sonnet-5-5");
    const prompt: string = req.messages[0].content;
    expect(prompt.indexOf("BEFORE")).toBeLessThan(prompt.indexOf("SELECTED"));
    expect(prompt.indexOf("SELECTED")).toBeLessThan(prompt.indexOf("AFTER"));
  });

  it("supports the dictation tidy action", async () => {
    expect(helperActions).toContain("tidy");
    parse.mockResolvedValue(ok({ replacement: "r", rationale: "why" }));
    await beatHelper({ action: "tidy", selection: "so um yeah", before: "", after: "" });
    expect(lastRequest().messages[0].content).toMatch(/dictation/i);
    expect(lastRequest().messages[0].content).toMatch(/blank line between paragraphs/);
  });

  it("passes a custom instruction through", async () => {
    parse.mockResolvedValue(ok({ replacement: "r", rationale: "why" }));
    await beatHelper({ action: "custom", instruction: "add a pirate voice", selection: "s", before: "", after: "" });
    expect(lastRequest().messages[0].content).toMatch(/Task: add a pirate voice/);
  });

  it("rejects unknown actions without calling the API", async () => {
    const err = await beatHelper({ action: "nope", selection: "s", before: "", after: "" }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("other helpers", () => {
  const beats = [
    { id: "b1", text: "First.", section: "Intro" },
    { id: "b2", text: "An aside.", kind: "aside" },
  ];

  it("suggestSections uses the deep model", async () => {
    parse.mockResolvedValue(ok({ sections: [], rationale: "" }));
    await suggestSections({ beats });
    expect(lastRequest().model).toBe("claude-opus-5-5");
    expect(lastRequest().output_config.effort).toBe("medium");
  });

  it("storyCoach applies the chosen lens and audience, falling back to no lens", async () => {
    parse.mockResolvedValue(ok({ summary: "", throughline: "", strengths: [], issues: [] }));
    await storyCoach({ beats, lens: "scr", audience: "nurses" });
    expect(lastRequest().system[0].text).toContain(LENSES.scr);
    expect(lastRequest().messages[0].content).toMatch(/Intended audience: nurses/);
    await storyCoach({ beats, lens: "bogus" });
    expect(lastRequest().system[0].text).toContain(LENSES.none);
  });

  it("beatPoints asks only for the requested ids", async () => {
    parse.mockResolvedValue(ok({ points: [] }));
    await beatPoints({ beats: [beats[0]], context: beats });
    expect(lastRequest().messages[0].content).toMatch(/beat ids only: b1$/);
  });

  it("visualIdeas includes passage and context", async () => {
    parse.mockResolvedValue(ok({ ideas: [] }));
    await visualIdeas({ passage: "the pump", context: "cholera" });
    expect(lastRequest().messages[0].content).toMatch(/<passage>\nthe pump\n<\/passage>/);
  });
});

describe("renderBeats", () => {
  it("marks asides and sections and escapes attribute values", () => {
    const out = renderBeats([
      { id: "a", text: "Hello", section: 'The "big" <idea>' },
      { id: "b", text: "Psst", kind: "aside" },
    ]);
    expect(out).toContain('<beat id="a" section="The &quot;big&quot; &lt;idea>">\nHello\n</beat>');
    expect(out).toContain('<beat id="b" kind="aside">');
  });
});
