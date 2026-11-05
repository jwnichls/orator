import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc, h, p } from "../../test/editor";
import { exportBundle } from "../model/bundle";
import { deleteTalk, getTalk, listTalks, newTalk, saveTalk } from "../model/store";
import { Library } from "./Library";

beforeEach(async () => {
  for (const t of await listTalks()) await deleteTalk(t.id);
  vi.restoreAllMocks();
});

describe("Library", () => {
  it("shows an empty state", async () => {
    render(<Library onOpen={() => {}} />);
    expect(await screen.findByText("No talks yet.")).toBeTruthy();
  });

  it("lists talks with their stats and opens one on click", async () => {
    const talk = { ...newTalk("Ghost Map"), doc: doc(h("s", "Intro"), p("a", "One two three."), p("b", "Four.")) };
    await saveTalk(talk);
    const onOpen = vi.fn();
    render(<Library onOpen={onOpen} />);
    fireEvent.click(await screen.findByText("Ghost Map"));
    expect(onOpen).toHaveBeenCalledWith(talk.id);
    expect(screen.getByText(/4 words · 2 paragraphs · 1 sections · 0 clips/)).toBeTruthy();
  });

  it("creates a new talk and opens it", async () => {
    const onOpen = vi.fn();
    render(<Library onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "New talk" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    expect((await getTalk(onOpen.mock.calls[0][0]))?.title).toBe("Untitled talk");
  });

  it("deletes after confirmation only", async () => {
    const talk = newTalk("Doomed");
    await saveTalk(talk);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Library onOpen={() => {}} />);
    const del = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(del);
    expect(await getTalk(talk.id)).toBeDefined();
    fireEvent.click(del);
    await waitFor(() => expect(screen.getByText("No talks yet.")).toBeTruthy());
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("imports a bundle as a new talk, and reports bad files", async () => {
    const original = { ...newTalk("Shared talk"), doc: doc(p("a", "Hello.")) };
    const bundle = await exportBundle(original);
    const onOpen = vi.fn();
    render(<Library onOpen={onOpen} />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([await bundle.arrayBuffer()], "shared.orator")] } });
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    const imported = await getTalk(onOpen.mock.calls[0][0]);
    expect(imported).toMatchObject({ title: "Shared talk", doc: original.doc });

    fireEvent.change(input, { target: { files: [new File(["not a zip"], "junk.orator")] } });
    expect(await screen.findByText(/zip|Orator/i, { selector: ".error" })).toBeTruthy();
  });
});
