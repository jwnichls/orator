import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doc, p } from "../../test/editor";
import { clipQuotes } from "../model/derive";
import { getTalk, newTalk, saveTalk } from "../model/store";
import type { Talk } from "../model/types";

const api = vi.hoisted(() => ({
  health: vi.fn(),
  points: vi.fn(),
  lenses: vi.fn(),
  visualIdeas: vi.fn(),
  searchImages: vi.fn(),
  helper: vi.fn(),
}));
vi.mock("../api", () => ({ api }));
const { Workspace } = await import("./Workspace");

const LONG = "In eighteen fifty four cholera swept through the streets of Soho.";

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.health.mockResolvedValue({ ok: true, ai: true });
  api.lenses.mockResolvedValue({});
  api.points.mockResolvedValue({ points: [] });
});
afterEach(() => vi.restoreAllMocks());

async function open(talk: Talk) {
  await saveTalk(talk);
  const onClose = vi.fn();
  render(<Workspace talkId={talk.id} onClose={onClose} />);
  await screen.findByLabelText("Talk title");
  const editor = document.querySelector<HTMLElement>(".ProseMirror")!;
  return { onClose, editor };
}

describe("Workspace", () => {
  it("loads a talk and shows its title and word count", async () => {
    await open({ ...newTalk("Ghost Map"), doc: doc(p("b1", "One two three four.")) });
    expect((screen.getByLabelText("Talk title") as HTMLInputElement).value).toBe("Ghost Map");
    expect(screen.getByText("4 words")).toBeTruthy();
  });

  it("says so when the talk doesn't exist", async () => {
    const onClose = vi.fn();
    render(<Workspace talkId="nope" onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("autosaves title edits", async () => {
    const talk = { ...newTalk("Draft"), doc: doc(p("b1", "Hi.")) };
    await open(talk);
    fireEvent.change(screen.getByLabelText("Talk title"), { target: { value: "The Ghost Map" } });
    await waitFor(async () => expect((await getTalk(talk.id))?.title).toBe("The Ghost Map"), { timeout: 2000 });
  });

  it("flags AI as offline", async () => {
    api.health.mockResolvedValue({ ok: true, ai: false });
    await open(newTalk());
    expect(await screen.findByText("AI offline")).toBeTruthy();
  });

  it("generates live outline points for long-enough beats and saves them", async () => {
    const talk = { ...newTalk(), doc: doc(p("b1", LONG), p("b2", "Too short.")) };
    api.points.mockImplementation(async ({ beats }: { beats: { id: string }[] }) => ({ points: beats.map((b) => ({ id: b.id, point: "Cholera hits Soho" })) }));
    await open(talk);
    await within(document.querySelector<HTMLElement>(".left-pane")!).findByText("Cholera hits Soho", {}, { timeout: 5000 });
    expect(api.points).toHaveBeenCalledTimes(1);
    expect(api.points.mock.calls[0][0].beats).toEqual([{ id: "b1", text: LONG }]);
    await waitFor(async () => expect((await getTalk(talk.id))?.points.b1?.text).toBe("Cholera hits Soho"), { timeout: 2000 });
  }, 10_000);

  it("anchors an uploaded image to the targeted passage", async () => {
    const talk = { ...newTalk(), doc: doc(p("b1", "The Broad Street pump.")) };
    api.health.mockResolvedValue({ ok: true, ai: false });
    const { editor } = await open(talk);
    // Put the cursor in the paragraph and target it for images.
    const textNode = editor.querySelector("p")!.firstChild!;
    act(() => {
      editor.focus();
      const sel = window.getSelection()!;
      sel.collapse(textNode, 3);
      document.dispatchEvent(new Event("selectionchange"));
    });
    fireEvent.click(screen.getByRole("button", { name: /Find images/ }));
    const input = await waitFor(() => document.querySelector<HTMLInputElement>('.right-pane input[type="file"]')!);
    fireEvent.change(input, { target: { files: [new File(["200x100"], "pump.png", { type: "image/png" })] } });
    await screen.findByText("Added to gathered content");

    await waitFor(async () => {
      const saved = (await getTalk(talk.id))!;
      const [clipId] = Object.keys(saved.clips);
      expect(clipQuotes(saved.doc).get(clipId)?.quote).toBe("The Broad Street pump.");
    }, { timeout: 2000 });
    expect(screen.getByRole("button", { name: "Gathered (1)" })).toBeTruthy();
    expect(document.querySelector(".clip-anchor")?.textContent).toBe("The Broad Street pump.");
  });

  it("exports an .orator bundle named after the talk", async () => {
    const talk = { ...newTalk("Ghost Map: 1854!"), doc: doc(p("b1", "Hi.")) };
    await open(talk);
    let downloaded: { name: string; href: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = { name: this.download, href: this.href };
    });
    const created = vi.spyOn(URL, "createObjectURL");
    fireEvent.click(screen.getByRole("button", { name: "Export .orator" }));
    await waitFor(() => expect(downloaded?.name).toBe("Ghost Map 1854.orator"));
    const zip = await JSZip.loadAsync(await (created.mock.calls[0][0] as Blob).arrayBuffer());
    expect(JSON.parse(await zip.file("talk.json")!.async("string")).title).toBe("Ghost Map: 1854!");
  });
});
