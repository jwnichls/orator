import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockStart, doc, makeEditor, p } from "../../test/editor";
import { deriveStructure } from "../model/derive";
import { newTalk, putAssetBlob } from "../model/store";
import type { Asset, Talk } from "../model/types";
import type { Target } from "./Workspace";

const api = vi.hoisted(() => ({ visualIdeas: vi.fn(), searchImages: vi.fn() }));
vi.mock("../api", () => ({ api }));
const { ContentPane } = await import("./ContentPane");

const ui = () => within(document.querySelector<HTMLElement>(".right-pane")!);

const result = (id: string, extra = {}) => ({
  provider: "wikimedia" as const,
  id,
  title: `Image ${id}`,
  thumbUrl: `https://up/t${id}.jpg`,
  url: `https://up/${id}.jpg`,
  pageUrl: `https://commons/${id}`,
  license: "Public domain",
  creator: "John Snow",
  width: 1920,
  height: 1800,
  ...extra,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  vi.unstubAllGlobals();
});

function setup({ talk = newTalk(), target = null as Target | null, ai = true, tab = "find" as "find" | "gathered", cursorClipIds = [] as string[] } = {}) {
  const editor = makeEditor(talk.doc);
  const props = {
    editor,
    talk,
    structure: deriveStructure(talk.doc),
    tab,
    setTab: vi.fn(),
    target,
    setTarget: vi.fn(),
    cursorClipIds,
    aiAvailable: ai,
    attachAsset: vi.fn(),
    removeClip: vi.fn(),
    reanchorClip: vi.fn(),
    updateClip: vi.fn(),
    setStatus: vi.fn(),
  };
  render(<ContentPane {...props} />);
  return props;
}

const target: Target = { from: 5, to: 17, text: "Broad Street", beatId: "b1" };

describe("Find", () => {
  it("asks for visual ideas, auto-searches the first query, and lets you pick another", async () => {
    api.visualIdeas.mockResolvedValue({
      ideas: [
        { idea: "Snow's original map", queries: ["john snow cholera map", "broad street map"] },
        { idea: "The pump", queries: ["broad street pump"] },
      ],
    });
    api.searchImages.mockResolvedValue({ results: [result("1"), result("2")], errors: [] });
    setup({ target });
    await ui().findByText("Snow's original map");
    expect(api.visualIdeas).toHaveBeenCalledWith({ passage: "Broad Street", context: "" });
    await waitFor(() => expect(api.searchImages).toHaveBeenCalledWith("john snow cholera map"));
    expect(await ui().findAllByRole("img")).toHaveLength(2);

    fireEvent.click(ui().getByRole("button", { name: "broad street pump" }));
    await waitFor(() => expect(api.searchImages).toHaveBeenLastCalledWith("broad street pump"));
  });

  it("shows progress while thinking of ideas and while searching", async () => {
    let finishIdeas!: (v: unknown) => void;
    let finishSearch!: (v: unknown) => void;
    api.visualIdeas.mockReturnValue(new Promise((r) => (finishIdeas = r)));
    api.searchImages.mockReturnValue(new Promise((r) => (finishSearch = r)));
    setup({ target });

    expect(ui().getByRole("status").textContent).toMatch(/Thinking about what could support this/);
    await act(async () => finishIdeas({ ideas: [{ idea: "Snow's map", queries: ["cholera map"] }] }));

    expect(ui().getByRole("status").textContent).toMatch(/Searching Openverse & Wikimedia Commons for “cholera map”/);
    expect(document.querySelectorAll(".right-pane .grid-item.skeleton")).toHaveLength(6);
    expect((ui().getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ui().queryByText("No results.")).toBeNull();

    await act(async () => finishSearch({ results: [result("1")], errors: [] }));
    expect(ui().queryByRole("status")).toBeNull();
    expect(document.querySelector(".right-pane .skeleton")).toBeNull();
    expect(ui().getAllByRole("img")).toHaveLength(1);
  });

  it("dims old results during a new search and ignores out-of-order responses", async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    api.searchImages.mockImplementation((q: string) => new Promise((r) => (pending[q] = r)));
    setup({ target, ai: false });
    const searchFor = (q: string) => {
      fireEvent.change(ui().getByPlaceholderText(/Search Openverse/), { target: { value: q } });
      fireEvent.submit(ui().getByPlaceholderText(/Search Openverse/).closest("form")!);
    };

    searchFor("first");
    await act(async () => pending.first({ results: [result("a")], errors: [] }));
    searchFor("slow");
    expect(document.querySelector(".right-pane .grid")!.className).toBe("grid stale");
    searchFor("fast");
    await act(async () => pending.fast({ results: [result("f1"), result("f2")], errors: [] }));
    await act(async () => pending.slow({ results: [result("s")], errors: [] })); // finishes last; must be ignored

    expect(ui().getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual(["Image f1", "Image f2"]);
    expect(document.querySelector(".right-pane .grid")!.className).toBe("grid");
    expect(ui().queryByRole("status")).toBeNull();
  });

  it("falls back to the full image when a thumbnail fails, then drops the tile", async () => {
    api.searchImages.mockResolvedValue({ results: [result("1"), result("2")], errors: [] });
    setup({ target, ai: false });
    fireEvent.change(ui().getByPlaceholderText(/Search Openverse/), { target: { value: "map" } });
    fireEvent.click(ui().getByRole("button", { name: "Search" }));
    const img = (await ui().findByAltText("Image 1")) as HTMLImageElement;
    expect(img.src).toBe("https://up/t1.jpg");
    fireEvent.error(img);
    expect(img.src).toBe("https://up/1.jpg");
    fireEvent.error(img);
    expect(ui().queryByAltText("Image 1")).toBeNull();
    expect(ui().getAllByRole("img")).toHaveLength(1);
  });

  it("without AI, waits for a typed query", async () => {
    api.searchImages.mockResolvedValue({ results: [], errors: ["Openverse timeout"] });
    const props = setup({ target, ai: false });
    expect(api.visualIdeas).not.toHaveBeenCalled();
    expect(api.searchImages).not.toHaveBeenCalled();
    fireEvent.change(ui().getByPlaceholderText(/Search Openverse/), { target: { value: "cholera" } });
    fireEvent.click(ui().getByRole("button", { name: "Search" }));
    await ui().findByText("No results.");
    expect(props.setStatus).toHaveBeenCalledWith("Some sources failed: Openverse timeout");
  });

  it("previews a result with its license and adds it to the passage as a local asset", async () => {
    api.searchImages.mockResolvedValue({ results: [result("9")], errors: [] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["1920x1800"], { type: "image/jpeg" }))));
    const props = setup({ target, ai: false });
    fireEvent.change(ui().getByPlaceholderText(/Search Openverse/), { target: { value: "map" } });
    fireEvent.click(ui().getByRole("button", { name: "Search" }));
    fireEvent.click(await ui().findByTitle("Image 9"));
    expect(ui().getByText(/by John Snow · Public domain · wikimedia · 1920×1800/)).toBeTruthy();
    fireEvent.click(ui().getByRole("button", { name: "Add to passage" }));
    await waitFor(() => expect(props.attachAsset).toHaveBeenCalled());
    const [asset, at] = props.attachAsset.mock.calls[0] as [Asset, Target];
    expect(at).toBe(target);
    expect(asset).toMatchObject({ mime: "image/jpeg", width: 1920, source: { provider: "wikimedia", license: "Public domain", pageUrl: "https://commons/9" } });
  });

  it("reports a failed download", async () => {
    api.searchImages.mockResolvedValue({ results: [result("9")], errors: [] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Upstream 404" }, { status: 502 })));
    const props = setup({ target, ai: false });
    fireEvent.change(ui().getByPlaceholderText(/Search Openverse/), { target: { value: "map" } });
    fireEvent.click(ui().getByRole("button", { name: "Search" }));
    fireEvent.click(await ui().findByTitle("Image 9"));
    fireEvent.click(ui().getByRole("button", { name: "Add to passage" }));
    await waitFor(() => expect(props.setStatus).toHaveBeenCalledWith("Couldn't add image: Upstream 404"));
    expect(props.attachAsset).not.toHaveBeenCalled();
  });

  it("uploads your own images, skipping non-images", async () => {
    const props = setup({ target, ai: false });
    const input = document.querySelector<HTMLInputElement>('.right-pane input[type="file"]')!;
    const files = [new File(["640x480"], "mine.png", { type: "image/png" }), new File(["x"], "notes.txt", { type: "text/plain" })];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(props.attachAsset).toHaveBeenCalledTimes(1));
    expect(props.attachAsset.mock.calls[0][0]).toMatchObject({ source: { provider: "upload", title: "mine.png" }, width: 640 });
  });

  it("targets the current paragraph from the empty state", () => {
    const talk = { ...newTalk(), doc: doc(p("b1", "The Broad Street pump.")) };
    const props = setup({ talk });
    props.editor.commands.setTextSelection(blockStart(props.editor, "b1") + 2);
    fireEvent.click(ui().getByRole("button", { name: "Find images for current paragraph" }));
    expect(props.setTarget).toHaveBeenCalledWith(expect.objectContaining({ text: "The Broad Street pump.", beatId: "b1" }));
  });
});

describe("Gathered", () => {
  async function talkWithClips(): Promise<Talk> {
    const a = await putAssetBlob(new Blob(["100x100"], { type: "image/png" }), { provider: "wikimedia", creator: "Snow", license: "CC0", pageUrl: "https://c/x" });
    return {
      ...newTalk(),
      doc: doc(p("b1", { text: "first anchor", clip: "c1" }), p("b2", "and ", { text: "second anchor", clip: "c2" })),
      clips: {
        c1: { id: "c1", assetId: a.id, createdAt: 1 },
        c2: { id: "c2", assetId: a.id, caption: "The map", createdAt: 2 },
        orphan: { id: "orphan", assetId: a.id, createdAt: 3 },
      },
    };
  }

  it("lists clips in script order, at-cursor first, and flags unanchored ones", async () => {
    const talk = await talkWithClips();
    setup({ talk, tab: "gathered", cursorClipIds: ["c2"] });
    const quotes = ui().getAllByTitle("Show in script").map((n) => n.textContent);
    expect(quotes).toEqual(["“second anchor”", "“first anchor”"]);
    expect(ui().getByText("At cursor")).toBeTruthy();
    expect(ui().getByText(/Unanchored/)).toBeTruthy();
    expect(ui().getByText("Not attached to text")).toBeTruthy();
    expect(ui().getByDisplayValue("The map")).toBeTruthy();
    expect((await ui().findAllByText(/Snow · CC0 · 100×100/)).length).toBe(3);
  });

  it("edits captions, re-anchors to the selection, and removes clips", async () => {
    const talk = await talkWithClips();
    const props = setup({ talk, tab: "gathered" });
    fireEvent.change(ui().getByDisplayValue("The map"), { target: { value: "Snow's map" } });
    expect(props.updateClip).toHaveBeenCalledWith("c2", { caption: "Snow's map" });

    props.editor.commands.setTextSelection({ from: blockStart(props.editor, "b2"), to: blockStart(props.editor, "b2") + 3 });
    fireEvent.click(ui().getAllByRole("button", { name: "Re-anchor" })[0]);
    expect(props.reanchorClip).toHaveBeenCalledWith("c1", expect.objectContaining({ text: "and" }));

    fireEvent.click(ui().getAllByRole("button", { name: "Remove" })[2]);
    expect(props.removeClip).toHaveBeenCalledWith("orphan");
  });

  it("explains itself when empty", () => {
    setup({ tab: "gathered" });
    expect(ui().getByText(/anchored to the words they support/)).toBeTruthy();
  });
});
