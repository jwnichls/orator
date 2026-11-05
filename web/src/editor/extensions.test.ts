import { describe, expect, it } from "vitest";
import { blockStart, doc, h, makeEditor, p, texts } from "../../test/editor";
import { clipQuotes, deriveStructure } from "../model/derive";
import { currentTarget, findBlockPos } from "./commands";

const ids = (e: ReturnType<typeof makeEditor>) => {
  const out: (string | null)[] = [];
  e.state.doc.forEach((n) => out.push(n.attrs.id));
  return out;
};

describe("BeatIds", () => {
  it("assigns ids to every paragraph and heading on load", async () => {
    const e = makeEditor(doc(p(null, "a"), h("", "Sec"), p("keep", "b")));
    await new Promise((r) => setTimeout(r)); // TipTap fires onCreate on the next tick
    const [a, sec, keep] = ids(e);
    expect(a).toMatch(/^[\w-]{10}$/);
    expect(sec).toMatch(/^[\w-]{10}$/);
    expect(keep).toBe("keep");
  });

  it("re-issues the id when a split duplicates it", () => {
    const e = makeEditor(doc(p("one", "Hello world")));
    e.chain().setTextSelection(blockStart(e, "one") + 5).splitBlock().run();
    const [first, second] = ids(e);
    expect(first).toBe("one");
    expect(second).not.toBe("one");
    expect(second).toBeTruthy();
    expect(texts(e)).toEqual(["Hello", " world"]);
  });

  it("does not put id assignment on the undo stack", () => {
    const e = makeEditor(doc(p("one", "Hello world")));
    e.chain().setTextSelection(blockStart(e, "one") + 5).splitBlock().run();
    e.commands.undo();
    expect(texts(e)).toEqual(["Hello world"]);
    expect(ids(e)).toEqual(["one"]);
  });

  it("round-trips ids and kinds through HTML", () => {
    const e = makeEditor(doc(p("a", "x")));
    e.commands.toggleAside();
    const html = e.getHTML();
    expect(html).toContain('data-id="a"');
    expect(html).toContain('data-kind="aside"');
    const e2 = makeEditor();
    e2.commands.setContent(html);
    expect(e2.getJSON().content![0].attrs).toMatchObject({ id: "a", kind: "aside" });
  });
});

describe("toggleAside", () => {
  it("toggles every paragraph in the selection to the same kind", () => {
    const e = makeEditor(doc(p("a", "one"), p("b", "two"), p("c", "three")));
    e.chain().setTextSelection({ from: blockStart(e, "a"), to: blockStart(e, "b") + 1 }).toggleAside().run();
    expect(deriveStructure(e.getJSON()).beats.map((b) => b.kind)).toEqual(["aside", "aside", "main"]);
    e.commands.toggleAside();
    expect(deriveStructure(e.getJSON()).beats.map((b) => b.kind)).toEqual(["main", "main", "main"]);
  });
});

describe("ClipMark", () => {
  it("anchors overlapping clips and removes one without touching the other", () => {
    const e = makeEditor(doc(p("a", "The Broad Street pump.")));
    const start = blockStart(e, "a");
    e.chain().setTextSelection({ from: start + 4, to: start + 16 }).addClipMark("map").run();
    e.chain().setTextSelection({ from: start + 10, to: start + 21 }).addClipMark("pump").run();
    let q = clipQuotes(e.getJSON());
    expect(q.get("map")?.quote).toBe("Broad Street");
    expect(q.get("pump")?.quote).toBe("Street pump");

    e.commands.removeClipMark("map");
    q = clipQuotes(e.getJSON());
    expect(q.has("map")).toBe(false);
    expect(q.get("pump")?.quote).toBe("Street pump");
  });

  it("does not extend the anchor when typing at its edge", () => {
    const e = makeEditor(doc(p("a", "pump")));
    const start = blockStart(e, "a");
    e.chain().setTextSelection({ from: start, to: start + 4 }).addClipMark("c").setTextSelection(start + 4).insertContent(" handle").run();
    expect(clipQuotes(e.getJSON()).get("c")?.quote).toBe("pump");
  });
});

describe("currentTarget / findBlockPos", () => {
  it("uses the selection when there is one", () => {
    const e = makeEditor(doc(p("a", "Hello world")));
    const start = blockStart(e, "a");
    e.commands.setTextSelection({ from: start + 6, to: start + 11 });
    expect(currentTarget(e)).toEqual({ from: start + 6, to: start + 11, text: "world", beatId: "a" });
  });

  it("falls back to the whole paragraph for an empty selection", () => {
    const e = makeEditor(doc(p("a", "First"), p("b", "Second para")));
    e.commands.setTextSelection(blockStart(e, "b") + 2);
    expect(currentTarget(e)).toMatchObject({ text: "Second para", beatId: "b" });
  });

  it("returns null in an empty paragraph", () => {
    const e = makeEditor(doc(p("a", "x"), p("b")));
    e.commands.setTextSelection(blockStart(e, "b"));
    expect(currentTarget(e)).toBeNull();
  });

  it("finds blocks by id", () => {
    const e = makeEditor(doc(p("a", "x"), h("s", "Sec")));
    expect(findBlockPos(e, "s")).toBe(blockStart(e, "s") - 1);
    expect(findBlockPos(e, "missing")).toBeNull();
  });
});

describe("placeholder", () => {
  const placeholders = (e: ReturnType<typeof makeEditor>) =>
    [...e.view.dom.querySelectorAll(".is-empty")].map((n) => n.getAttribute("data-placeholder"));

  it("prompts only while the script is blank", () => {
    const e = makeEditor();
    e.commands.focus();
    expect(placeholders(e)).toEqual(["Start writing what you'll say…"]);
    e.commands.insertContent("Hello");
    e.commands.splitBlock();
    expect(placeholders(e)).toEqual([""]);
  });

  it("labels empty section headings", () => {
    const e = makeEditor(doc(p("a", "x"), h("s", "")));
    e.commands.setTextSelection(blockStart(e, "s"));
    e.commands.focus();
    expect(placeholders(e)).toEqual(["Section title"]);
  });
});
