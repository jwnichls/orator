import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleProvider, googleProvider, pemToPkcs8 } from "./auth.ts";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const future = () => Math.floor(Date.now() / 1000) + 600;

/** Stub the provider's token endpoint, capturing the request. */
function tokenEndpoint(claims: Record<string, unknown>) {
  const calls: { url: string; body: URLSearchParams; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const req = new Request(input, init);
      calls.push({ url: req.url, body: new URLSearchParams(await req.text()), headers: req.headers });
      return Response.json({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken(claims) });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("googleProvider", () => {
  const google = googleProvider("client-123", "shh");
  const redirect = "https://www.orator-ai.com/api/auth/google/callback";
  const good = { iss: "https://accounts.google.com", aud: "client-123", sub: "g-42", exp: future(), email: "ada@example.com", email_verified: true, name: "Ada", picture: "https://lh3/p.jpg" };

  it("asks for an OpenID profile with PKCE and an account chooser", () => {
    const url = google.authorizeUrl(redirect, "st", "verifier-verifier-verifier-verifier-verifier");
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("redirect_uri")).toBe(redirect);
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("exchanges the code and maps the ID token to a profile", async () => {
    const calls = tokenEndpoint(good);
    const profile = await google.exchange(redirect, "code-1", "verifier-verifier-verifier-verifier-verifier");
    expect(profile).toEqual({ provider: "google", subject: "g-42", email: "ada@example.com", emailVerified: true, name: "Ada", avatarUrl: "https://lh3/p.jpg" });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].body.get("code")).toBe("code-1");
    expect(calls[0].body.get("code_verifier")).toBe("verifier-verifier-verifier-verifier-verifier");
  });

  it("treats an unverified email as unverified", async () => {
    tokenEndpoint({ ...good, email_verified: false });
    expect((await google.exchange(redirect, "c", "v".repeat(43))).emailVerified).toBe(false);
  });

  it.each([
    ["another issuer", { iss: "https://evil.example" }, /issuer/],
    ["another app's token", { aud: "someone-else" }, /audience/],
    ["an expired token", { exp: 1000 }, /expired/],
    ["no subject", { sub: undefined }, /subject/],
  ])("rejects %s", async (_label, over, error) => {
    tokenEndpoint({ ...good, ...over });
    await expect(google.exchange(redirect, "c", "v".repeat(43))).rejects.toThrow(error);
  });
});

describe("appleProvider", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const cfg = { clientId: "com.orator.web", teamId: "TEAM123", keyId: "KEY456", privateKey: pem.replace(/\n/g, "\\n") };
  const apple = appleProvider(cfg);
  const redirect = "https://www.orator-ai.com/api/auth/apple/callback";
  const good = { iss: "https://appleid.apple.com", aud: "com.orator.web", sub: "a-7", exp: future(), email: "x@privaterelay.appleid.com", email_verified: "true" };

  it("asks for name and email via form_post", () => {
    const url = apple.authorizeUrl(redirect, "st", "unused");
    expect(url.origin).toBe("https://appleid.apple.com");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
    expect(url.searchParams.get("scope")).toBe("name email");
    expect(url.searchParams.get("client_id")).toBe("com.orator.web");
  });

  it("signs a client secret with the .p8 key and reads the profile", async () => {
    const calls = tokenEndpoint(good);
    const user = JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" } });
    const profile = await apple.exchange(redirect, "code-1", "", { user });
    expect(profile).toEqual({ provider: "apple", subject: "a-7", email: "x@privaterelay.appleid.com", emailVerified: true, name: "Ada Lovelace", avatarUrl: null });
    expect(calls[0].url).toBe("https://appleid.apple.com/auth/token");
    const secret = calls[0].body.get("client_secret") ?? "";
    const [header, claims] = secret.split(".").slice(0, 2).map((p) => JSON.parse(Buffer.from(p, "base64url").toString()));
    expect(header).toMatchObject({ alg: "ES256", kid: "KEY456" });
    expect(claims).toMatchObject({ iss: "TEAM123", sub: "com.orator.web", aud: ["https://appleid.apple.com"] });
  });

  it("copes with no or malformed name data", async () => {
    tokenEndpoint(good);
    expect((await apple.exchange(redirect, "c", "", { user: "{not json" })).name).toBeNull();
    tokenEndpoint({ ...good, email_verified: false });
    expect(await apple.exchange(redirect, "c", "")).toMatchObject({ name: null, emailVerified: false });
  });

  it("rejects tokens for another app", async () => {
    tokenEndpoint({ ...good, aud: "com.other.app" });
    await expect(apple.exchange(redirect, "c", "")).rejects.toThrow(/audience/);
  });
});

describe("pemToPkcs8", () => {
  it("accepts real or escaped newlines", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const der = new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" }));
    expect(pemToPkcs8(pem)).toEqual(der);
    expect(pemToPkcs8(pem.replace(/\n/g, "\\n"))).toEqual(der);
  });
});
