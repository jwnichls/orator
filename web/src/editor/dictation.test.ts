import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockStart, doc, makeEditor, p, texts } from "../../test/editor";
import { FakeRecognition, installFakeSpeech } from "../../test/speech";
import { useDictation } from "./dictation";

beforeEach(installFakeSpeech);

function setup(content = doc(p("a", "Intro sentence."))) {
  const editor = makeEditor(content);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1); // end of last paragraph
  const onError = vi.fn();
  const hook = renderHook(() => useDictation(editor, onError));
  return { editor, onError, hook, get d() { return hook.result.current; } };
}

describe("useDictation", () => {
  it("configures continuous recognition with interim results", () => {
    const t = setup();
    act(() => t.d.start());
    expect(t.d.listening).toBe(true);
    expect(FakeRecognition.last).toMatchObject({ continuous: true, interimResults: true, starts: 1 });
  });

  it("inserts final phrases at the cursor with spacing and sentence capitalization", () => {
    const t = setup();
    act(() => t.d.start());
    FakeRecognition.last.say("so the thing about cholera");
    FakeRecognition.last.say("was the water");
    expect(texts(t.editor)).toEqual(["Intro sentence. So the thing about cholera was the water"]);
  });

  it("shows interim text without inserting it", () => {
    const t = setup();
    act(() => t.d.start());
    FakeRecognition.last.hear("so the");
    expect(t.d.interim).toBe("so the");
    expect(texts(t.editor)).toEqual(["Intro sentence."]);
    FakeRecognition.last.say("so the pump");
    expect(t.d.interim).toBe("");
  });

  it('starts a new paragraph on "new paragraph"', () => {
    const t = setup(doc(p("a")));
    act(() => t.d.start());
    FakeRecognition.last.say("first thought new paragraph second thought");
    expect(texts(t.editor)).toEqual(["First thought", "Second thought"]);
  });

  it("keeps listening through silence until stopped", () => {
    const t = setup();
    act(() => t.d.start());
    FakeRecognition.last.end(); // the browser ends recognition after a pause
    expect(FakeRecognition.last.starts).toBe(2);
    expect(t.d.listening).toBe(true);
    act(() => t.d.stop());
    expect(t.d.listening).toBe(false);
  });

  it("ignores benign no-speech errors and reports blocked microphones", () => {
    const t = setup();
    act(() => t.d.start());
    FakeRecognition.last.fail("no-speech");
    expect(t.onError).not.toHaveBeenCalled();
    FakeRecognition.last.fail("not-allowed");
    FakeRecognition.last.end();
    expect(t.onError).toHaveBeenCalledWith(expect.stringMatching(/Microphone access was blocked/));
    expect(t.d.listening).toBe(false);
    expect(FakeRecognition.last.starts).toBe(1); // did not restart
  });

  it("reports the dictated range after stopping, mapped through later edits", () => {
    const t = setup();
    act(() => t.d.start());
    FakeRecognition.last.say("so um yeah");
    act(() => t.d.stop());
    const range = t.d.lastRange!;
    expect(t.editor.state.doc.textBetween(range.from, range.to)).toBe(" So um yeah");

    // Typing before the dictated text shifts it; the range follows.
    act(() => void t.editor.chain().setTextSelection(blockStart(t.editor, "a")).insertContent("Well. ").run());
    const moved = t.d.lastRange!;
    expect(t.editor.state.doc.textBetween(moved.from, moved.to)).toBe(" So um yeah");

    act(() => t.d.clearRange());
    expect(t.d.lastRange).toBeNull();
  });

  it("reports no range when nothing was said", () => {
    const t = setup();
    act(() => t.d.start());
    act(() => t.d.stop());
    expect(t.d.lastRange).toBeNull();
  });
});
