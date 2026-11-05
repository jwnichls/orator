import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../api";

const api = vi.hoisted(() => ({ setAnthropicKey: vi.fn(), removeAnthropicKey: vi.fn() }));
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), api }));
const { Account } = await import("./Account");

const ada: User = { id: "ada", email: "ada@example.com", name: "Ada Lovelace", avatarUrl: null, hasAnthropicKey: false, anthropicKeyHint: null };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});

function setup(user = ada) {
  const props = { user, onUser: vi.fn(), onSignOut: vi.fn(), onClose: vi.fn() };
  render(<Account {...props} />);
  return props;
}

describe("Account", () => {
  it("shows who is signed in", () => {
    setup();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("AL")).toBeTruthy(); // initials when there's no picture
    expect(screen.getByText(/No key yet/)).toBeTruthy();
  });

  it("saves a key, clearing the field and never displaying it", async () => {
    const props = setup();
    const withKey = { ...ada, hasAnthropicKey: true, anthropicKeyHint: "wxyz" };
    api.setAnthropicKey.mockResolvedValue(withKey);
    const input = screen.getByLabelText("Anthropic API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect((screen.getByRole("button", { name: "Save key" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "sk-ant-secret-wxyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByText(/checked with Anthropic and saved/);
    expect(api.setAnthropicKey).toHaveBeenCalledWith("sk-ant-secret-wxyz");
    expect(props.onUser).toHaveBeenCalledWith(withKey);
    expect(input.value).toBe("");
  });

  it("shows why a key was refused", async () => {
    setup();
    api.setAnthropicKey.mockRejectedValue(new Error("Anthropic didn't accept that key."));
    fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "sk-ant-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByText("Anthropic didn't accept that key.")).toBeTruthy();
  });

  it("shows the saved key's hint and removes it", async () => {
    const props = setup({ ...ada, hasAnthropicKey: true, anthropicKeyHint: "wxyz" });
    expect(screen.getByText("Key saved, ending in …wxyz")).toBeTruthy();
    api.removeAnthropicKey.mockResolvedValue(ada);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(props.onUser).toHaveBeenCalledWith(ada));
  });

  it("signs out and goes back", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByRole("button", { name: /Talks/ }));
    expect(props.onSignOut).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });
});
