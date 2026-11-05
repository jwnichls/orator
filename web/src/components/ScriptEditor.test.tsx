import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockStart, doc, makeEditor, p, texts } from "../../test/editor";
import { FakeRecognition, installFakeSpeech } from "../../test/speech";

// Dictation support is detected at import time.
vi.hoisted(() => {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class {};
});
const api = vi.hoisted(() => ({ helper: vi.fn() }));
vi.mock("../api", () => ({ api }));

const { ScriptEditor } = await import("./ScriptEditor");

beforeEach(() => {
  installFakeSpeech();
  api.helper.mockReset();
});

function setup(content = doc(p("a", "Intro sentence."), p("b", "We has a problem with the data."))) {
  const editor = makeEditor(content);
  const onFindImages = vi.fn();
  const setStatus = vi.fn();
  render(<ScriptEditor editor={editor} aiAvailable onFindImages={onFindImages} setStatus={setStatus} />);
  return { editor, onFindImages, setStatus };
}

const selectWords = (editor: ReturnType<typeof makeEditor>, id: string, from: number, to: number) =>
  act(() => void editor.chain().focus().setTextSelection({ from: blockStart(editor, id) + from, to: blockStart(editor, id) + to }).run());

describe("writing helpers", () => {
  it("offers helpers for a selection and shows the result as a diff", async () => {
    const { editor } = setup();
    selectWords(editor, "b", 0, 6); // "We has"
    api.helper.mockResolvedValue({ replacement: "We have", rationale: "Grammar." });
    fireEvent.click(await screen.findByRole("button", { name: "Tighten" }));
    await screen.findByText("Suggested edit");
    expect(api.helper).toHaveBeenCalledWith(expect.objectContaining({ action: "tighten", selection: "We has", before: expect.stringContaining("Intro sentence.") }));
    expect(screen.getByText("We has", { selector: ".del" })).toBeTruthy();
    expect(screen.getByText("We have", { selector: ".ins" })).toBeTruthy();
    expect(screen.getByText("Grammar.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(texts(editor)).toEqual(["Intro sentence.", "We have a problem with the data."]);
    expect(screen.queryByText("Suggested edit")).toBeNull();
  });

  it("splits a multi-paragraph replacement but keeps surrounding text in place", async () => {
    const { editor } = setup(doc(p("a", "Keep this. Rewrite me please. Keep that.")));
    selectWords(editor, "a", 11, 29); // "Rewrite me please."
    api.helper.mockResolvedValue({ replacement: "One.\n\nTwo.", rationale: "" });
    fireEvent.click(await screen.findByRole("button", { name: "Expand" }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(texts(editor)).toEqual(["Keep this. One.", "Two. Keep that."]);
  });

  it("discards a suggestion if the text changed meanwhile", async () => {
    const { editor, setStatus } = setup();
    selectWords(editor, "b", 0, 6);
    api.helper.mockResolvedValue({ replacement: "We have", rationale: "" });
    fireEvent.click(await screen.findByRole("button", { name: "Tighten" }));
    await screen.findByText("Suggested edit");
    act(() => void editor.chain().setTextSelection(blockStart(editor, "b")).insertContent("Oh, ").run());
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(setStatus).toHaveBeenCalledWith(expect.stringMatching(/changed since/));
    expect(texts(editor)[1]).toBe("Oh, We has a problem with the data.");
  });

  it("sends custom instructions from Ask…", async () => {
    const { editor } = setup();
    selectWords(editor, "b", 0, 6);
    api.helper.mockResolvedValue({ replacement: "x", rationale: "" });
    fireEvent.click(await screen.findByRole("button", { name: "Ask…" }));
    fireEvent.change(screen.getByPlaceholderText(/concrete example/), { target: { value: "make it rhyme" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(api.helper).toHaveBeenCalledWith(expect.objectContaining({ action: "custom", instruction: "make it rhyme" })));
  });

  it("surfaces helper errors as status", async () => {
    const { editor, setStatus } = setup();
    selectWords(editor, "b", 0, 6);
    api.helper.mockRejectedValue(new Error("AI is offline"));
    fireEvent.click(await screen.findByRole("button", { name: "Tighten" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("AI is offline"));
  });
});

describe("toolbar", () => {
  it("toggles sections and asides on the current paragraph", () => {
    const { editor } = setup();
    act(() => void editor.commands.setTextSelection(blockStart(editor, "a") + 1));
    fireEvent.click(screen.getByRole("button", { name: /Section/ }));
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    act(() => void editor.commands.setTextSelection(blockStart(editor, "b") + 1));
    fireEvent.click(screen.getByRole("button", { name: /Aside/ }));
    expect(editor.state.doc.child(1).attrs.kind).toBe("aside");
  });

  it("finds images for the current paragraph", () => {
    const { editor, onFindImages } = setup();
    act(() => void editor.commands.setTextSelection(blockStart(editor, "b") + 1));
    fireEvent.click(screen.getByRole("button", { name: /Find images/ }));
    expect(onFindImages).toHaveBeenCalledWith(expect.objectContaining({ text: "We has a problem with the data.", beatId: "b" }));
  });
});

describe("dictation", () => {
  it("dictates, then tidies only the dictated text into the same paragraph", async () => {
    const { editor } = setup(doc(p("a", "Intro sentence.")));
    act(() => void editor.commands.setTextSelection(editor.state.doc.content.size - 1));
    fireEvent.click(screen.getByRole("button", { name: /Dictate/ }));
    expect(screen.getByRole("button", { name: /Stop/ })).toBeTruthy();
    expect(screen.getByText(/Listening/)).toBeTruthy();

    FakeRecognition.last.hear("so um");
    expect(screen.getByText("so um")).toBeTruthy();
    FakeRecognition.last.say("so um the pump new paragraph and and snow knew");
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(texts(editor)).toEqual(["Intro sentence. So um the pump", "And and snow knew"]);

    api.helper.mockResolvedValue({ replacement: "So, the pump.\n\nAnd Snow knew.", rationale: "Removed fillers." });
    fireEvent.click(screen.getByRole("button", { name: "Tidy it up" }));
    await screen.findByText("Suggested edit");
    expect(api.helper).toHaveBeenCalledWith(expect.objectContaining({ action: "tidy", selection: "So um the pump\n\nAnd and snow knew" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(texts(editor)).toEqual(["Intro sentence. So, the pump.", "And Snow knew."]);
  });

  it("can keep dictation as is", () => {
    const { editor } = setup(doc(p("a")));
    act(() => void editor.commands.setTextSelection(1));
    fireEvent.click(screen.getByRole("button", { name: /Dictate/ }));
    FakeRecognition.last.say("hello there");
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    fireEvent.click(screen.getByRole("button", { name: "Keep as is" }));
    expect(screen.queryByText("Dictation added.")).toBeNull();
    expect(texts(editor)).toEqual(["Hello there"]);
    expect(api.helper).not.toHaveBeenCalled();
  });
});
