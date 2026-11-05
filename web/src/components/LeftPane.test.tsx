import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aside, doc, h, makeEditor, p, texts } from "../../test/editor";
import { deriveStructure, hashText } from "../model/derive";
import { newTalk } from "../model/store";
import type { Talk } from "../model/types";

const api = vi.hoisted(() => ({ sections: vi.fn(), coach: vi.fn(), lenses: vi.fn() }));
vi.mock("../api", () => ({ api }));
const { LeftPane } = await import("./LeftPane");

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.lenses.mockResolvedValue({ none: "No lens", scr: "SCR" });
});

const script = doc(
  p("b1", "In 1854 cholera swept through Soho."),
  p("b2", "Everyone blamed bad air."),
  aside("b3", "A quick aside about miasma."),
  p("b4", "John Snow ", { text: "mapped the deaths", clip: "c1" }, "."),
);

function Harness({ editor, talk, ai = true }: { editor: ReturnType<typeof makeEditor>; talk: Talk; ai?: boolean }) {
  // Re-derive on every editor change, as Workspace does.
  const [docJson, setDoc] = useState(editor.getJSON());
  editor.on("update", () => setDoc(editor.getJSON()));
  const structure = deriveStructure(docJson);
  return (
    <LeftPane editor={editor} talk={talk} structure={structure} aiAvailable={ai} liveOutline setLiveOutline={() => {}} setStatus={() => {}} />
  );
}

function setup(content = script, points: Talk["points"] = {}, ai = true) {
  const editor = makeEditor(content);
  const talk = { ...newTalk(), doc: content, points };
  render(<Harness editor={editor} talk={talk} ai={ai} />);
  return { editor, talk };
}

// The editor's own text is in the document too; query only the pane.
const ui = () => within(document.querySelector<HTMLElement>(".left-pane")!);

describe("Outline", () => {
  it("shows points when fresh, snippets otherwise, with aside and image badges", () => {
    setup(script, {
      b1: { text: "Cholera hits Soho", hash: hashText("In 1854 cholera swept through Soho.") },
      b2: { text: "Old point", hash: "stale" },
    });
    expect(ui().getByText("Cholera hits Soho").className).toBe("");
    expect(ui().getByText("Old point").className).toBe("muted"); // stale point is muted
    expect(ui().getByText("A quick aside about miasma.")).toBeTruthy();
    expect(ui().getByText("aside")).toBeTruthy();
    expect(ui().getByText("🖼 1")).toBeTruthy();
  });

  it("groups beats under section headings and jumps on click", () => {
    const { editor } = setup(doc(h("s1", "Setup"), p("b1", "One two three."), h("s2", "Turn"), p("b2", "Four five six.")));
    expect(ui().getByText("Setup")).toBeTruthy();
    fireEvent.click(ui().getByText("Four five six."));
    expect(editor.state.selection.$from.parent.attrs.id).toBe("b2");
  });

  it("proposes sections and applies them, replacing existing headings", async () => {
    const { editor } = setup(doc(h("old", "Old heading"), ...script.content!));
    api.sections.mockResolvedValue({
      rationale: "Two movements.",
      sections: [
        { title: "The outbreak", startBeatId: "b1", purpose: "Set the scene" },
        { title: "The map", startBeatId: "b4", purpose: "The turn" },
      ],
    });
    fireEvent.click(ui().getByRole("button", { name: "Suggest sections" }));
    await ui().findByText("Two movements.");
    expect(api.sections).toHaveBeenCalledWith({ beats: expect.arrayContaining([{ id: "b3", text: "A quick aside about miasma.", kind: "aside" }]) });
    expect(ui().getByText(/Replaces your 1 existing section headings/)).toBeTruthy();

    fireEvent.click(ui().getByRole("button", { name: "Apply" }));
    expect(texts(editor)).toEqual([
      "The outbreak",
      "In 1854 cholera swept through Soho.",
      "Everyone blamed bad air.",
      "A quick aside about miasma.",
      "The map",
      "John Snow mapped the deaths.",
    ]);
    const { sections } = deriveStructure(editor.getJSON());
    expect(sections.map((s) => [s.title, s.beatIds])).toEqual([
      ["The outbreak", ["b1", "b2", "b3"]],
      ["The map", ["b4"]],
    ]);
  });

  it("disables AI actions when AI is offline", () => {
    setup(script, {}, false);
    expect((ui().getByRole("button", { name: "Suggest sections" }) as HTMLButtonElement).disabled).toBe(true);
    expect((ui().getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("Story coach", () => {
  it("critiques through the chosen lens and links issues to beats", async () => {
    const { editor } = setup();
    fireEvent.click(ui().getByRole("button", { name: "Story coach" }));
    await waitFor(() => expect(ui().getAllByRole("option")).toHaveLength(2));
    fireEvent.change(ui().getByRole("combobox"), { target: { value: "scr" } });
    fireEvent.change(ui().getByPlaceholderText(/hospital administrators/), { target: { value: "epidemiologists" } });
    api.coach.mockResolvedValue({
      throughline: "Pictures of data change minds.",
      summary: "A tight arc.",
      strengths: ["Vivid opening"],
      issues: [{ beatId: "b2", issue: "Stakes are thin", suggestion: "Say who was dying." }],
    });
    fireEvent.click(ui().getByRole("button", { name: "Critique story" }));
    await ui().findByText("Pictures of data change minds.");
    expect(api.coach).toHaveBeenCalledWith(expect.objectContaining({ lens: "scr", audience: "epidemiologists" }));
    expect(ui().getByText("Vivid opening")).toBeTruthy();

    act(() => fireEvent.click(ui().getByText("Stakes are thin")));
    expect(editor.state.selection.$from.parent.attrs.id).toBe("b2");
  });
});
