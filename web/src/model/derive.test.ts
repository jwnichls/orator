import { describe, expect, it } from "vitest";
import { aside, doc, h, p } from "../../test/editor";
import { clipQuotes, deriveStructure, hashText, wordCount } from "./derive";

describe("deriveStructure", () => {
  it("turns paragraphs into beats and headings into optional sections", () => {
    const { beats, sections } = deriveStructure(
      doc(p("b0", "Before any section."), h("s1", "Intro"), p("b1", "Hello ", { text: "world", clip: "c1" }), aside("b2", "Psst."), h("s2", ""), p("b3", "Later.")),
    );
    expect(beats.map((b) => [b.id, b.kind, b.sectionId ?? null])).toEqual([
      ["b0", "main", null],
      ["b1", "main", "s1"],
      ["b2", "aside", "s1"],
      ["b3", "main", "s2"],
    ]);
    expect(beats[1]).toMatchObject({ text: "Hello world", sectionTitle: "Intro", clipIds: ["c1"] });
    expect(sections).toEqual([
      { id: "s1", title: "Intro", beatIds: ["b1", "b2"] },
      { id: "s2", title: "Untitled section", beatIds: ["b3"] },
    ]);
  });

  it("skips empty paragraphs and blocks without ids", () => {
    const { beats } = deriveStructure(doc(p("a", "   "), p(null, "no id yet"), { type: "paragraph", attrs: { id: "e" } }, p("b", "real")));
    expect(beats.map((b) => b.id)).toEqual(["b"]);
  });

  it("dedupes clip ids within a beat", () => {
    const { beats } = deriveStructure(doc(p("a", { text: "one", clip: ["c1", "c2"] }, " ", { text: "two", clip: "c1" })));
    expect(beats[0].clipIds.sort()).toEqual(["c1", "c2"]);
  });
});

describe("clipQuotes", () => {
  it("collects the anchored text per clip, including overlaps", () => {
    const quotes = clipQuotes(doc(p("a", "The ", { text: "Broad Street ", clip: ["map", "pump"] }, { text: "pump", clip: "pump" }, "."), p("b", "Unrelated.")));
    expect(quotes.get("map")).toEqual({ beatId: "a", quote: "Broad Street " });
    expect(quotes.get("pump")).toEqual({ beatId: "a", quote: "Broad Street pump" });
    expect(quotes.size).toBe(2);
  });

  it("keeps the first beat for a clip spanning beats", () => {
    const quotes = clipQuotes(doc(p("a", { text: "end of one", clip: "x" }), p("b", { text: " start of two", clip: "x" })));
    expect(quotes.get("x")).toEqual({ beatId: "a", quote: "end of one start of two" });
  });
});

describe("wordCount / hashText", () => {
  it("counts words across whitespace", () => {
    expect(wordCount("  one two\n\tthree ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });

  it("is stable and change-sensitive", () => {
    expect(hashText("hello")).toBe(hashText("hello"));
    expect(hashText("hello")).not.toBe(hashText("hello."));
    expect(hashText("")).toMatch(/^[0-9a-z]+$/);
  });
});
