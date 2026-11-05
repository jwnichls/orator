import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "./api";

const api = vi.hoisted(() => ({ me: vi.fn(), providers: vi.fn(), logout: vi.fn(), setAnthropicKey: vi.fn(), removeAnthropicKey: vi.fn(), lenses: vi.fn(), points: vi.fn() }));
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), api }));
const { default: App } = await import("./App");
const { SIGNED_OUT_EVENT } = await import("./api");
const { listTalks, newTalk, saveTalk, setStoreUser } = await import("./model/store");

const ada: User = { id: "ada", email: "ada@example.com", name: "Ada", avatarUrl: null, hasAnthropicKey: false, anthropicKeyHint: null };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.providers.mockResolvedValue({ google: true, apple: true, dev: false });
  api.logout.mockResolvedValue({ ok: true });
  api.lenses.mockResolvedValue({});
  location.hash = "";
  history.replaceState(null, "", "/");
});
afterEach(() => setStoreUser("test-user"));

describe("App", () => {
  it("shows sign-in options when signed out", async () => {
    api.me.mockResolvedValue(null);
    render(<App />);
    const google = await screen.findByRole("link", { name: /Continue with Google/ });
    expect(google.getAttribute("href")).toBe("/api/auth/google");
    expect(screen.getByRole("link", { name: /Continue with Apple/ }).getAttribute("href")).toBe("/api/auth/apple");
    expect(screen.queryByRole("link", { name: /local developer/ })).toBeNull();
  });

  it("shows a sign-in error from the server once and cleans the URL", async () => {
    history.replaceState(null, "", "/?auth_error=Sign-in%20was%20cancelled.");
    api.me.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByText("Sign-in was cancelled.")).toBeTruthy();
    expect(location.search).toBe("");
  });

  it("opens the signed-in user's own library", async () => {
    await setStoreUser("ada");
    await saveTalk(newTalk("Ada's talk"));
    await setStoreUser("someone-else");
    api.me.mockResolvedValue(ada);
    render(<App />);
    expect(await screen.findByText("Ada's talk")).toBeTruthy();
    expect((await listTalks()).map((t) => t.title)).toEqual(["Ada's talk"]);
  });

  it("returns to sign-in when the session ends", async () => {
    api.me.mockResolvedValue(ada);
    render(<App />);
    await screen.findByRole("button", { name: "New talk" });
    act(() => void window.dispatchEvent(new Event(SIGNED_OUT_EVENT)));
    expect(await screen.findByRole("link", { name: /Continue with Google/ })).toBeTruthy();
  });

  it("shows the account page and signs out from it", async () => {
    api.me.mockResolvedValue(ada);
    location.hash = "#/account";
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(await screen.findByRole("link", { name: /Continue with Google/ })).toBeTruthy();
  });

  it("enables AI in a talk once the user adds a key", async () => {
    api.me.mockResolvedValue(ada);
    await setStoreUser("ada");
    const talk = newTalk("T");
    await saveTalk(talk);
    location.hash = `#/talk/${talk.id}`;
    render(<App />);
    expect(await screen.findByRole("link", { name: /Add your API key/ })).toBeTruthy();

    api.setAnthropicKey.mockResolvedValue({ ...ada, hasAnthropicKey: true, anthropicKeyHint: "abcd" });
    act(() => void (location.hash = "#/account"));
    fireEvent.change(await screen.findByLabelText("Anthropic API key"), { target: { value: "sk-ant-x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByText(/ending in …abcd/);

    act(() => void (location.hash = `#/talk/${talk.id}`));
    await screen.findByLabelText("Talk title");
    expect(screen.queryByRole("link", { name: /Add your API key/ })).toBeNull();
  });
});
