import { act } from "@testing-library/react";

/** Stand-in for the browser's SpeechRecognition; tests drive it with say()/hear()/end(). */
export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static get last() {
    return FakeRecognition.instances.at(-1)!;
  }

  continuous = false;
  interimResults = false;
  lang = "";
  starts = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.starts++;
  }
  stop() {
    this.end();
  }

  private emit(transcript: string, isFinal: boolean) {
    act(() => this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal, 0: { transcript } } } }));
  }
  /** A finalized phrase. */
  say(transcript: string) {
    this.emit(transcript, true);
  }
  /** An in-progress (interim) phrase. */
  hear(transcript: string) {
    this.emit(transcript, false);
  }
  end() {
    act(() => this.onend?.());
  }
  fail(error: string) {
    act(() => this.onerror?.({ error }));
  }
}

export function installFakeSpeech() {
  FakeRecognition.instances = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
}
