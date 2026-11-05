import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adoptServerKey,
  createSession,
  deleteSession,
  getAnthropicKey,
  setAnthropicKey,
  signIn,
  SESSION_TTL_MS,
  validateSession,
  type ProviderProfile,
} from "./accounts.ts";
import { migrate, type Db } from "./db.ts";
import { decryptSecret, encryptSecret, sha256 } from "./secrets.ts";
import { resetDb, testDb } from "./testing.ts";

let db: Db;
beforeAll(async () => void (db = await testDb()));
afterAll(() => db.close());
beforeEach(() => resetDb(db));

const SECRET = "test-secret";
const google = (over: Partial<ProviderProfile> = {}): ProviderProfile => ({
  provider: "google",
  subject: "g-123",
  email: "Jeff@Example.com",
  emailVerified: true,
  name: "Jeff",
  avatarUrl: "https://lh3/pic.jpg",
  ...over,
});

describe("migrations", () => {
  it("are idempotent", async () => {
    await migrate(db);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from schema_migrations");
    expect(rows[0].n).toBe(1);
  });
});

describe("signIn", () => {
  it("creates an account on first sign-in and finds it again after", async () => {
    const first = await signIn(db, google());
    expect(first.created).toBe(true);
    expect(first.user).toMatchObject({ email: "jeff@example.com", name: "Jeff", avatarUrl: "https://lh3/pic.jpg", hasAnthropicKey: false });
    const again = await signIn(db, google({ name: "Changed" }));
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.name).toBe("Jeff"); // existing details are kept
  });

  it("links a second provider with the same verified email to the same account", async () => {
    const g = await signIn(db, google());
    const a = await signIn(db, { provider: "apple", subject: "a-9", email: "jeff@example.com", emailVerified: true, name: null, avatarUrl: null });
    expect(a.created).toBe(false);
    expect(a.user.id).toBe(g.user.id);
    const { rows } = await db.query("select provider from identities where user_id = $1 order by provider", [g.user.id]);
    expect(rows.map((r) => r.provider)).toEqual(["apple", "google"]);
  });

  it("never links or stores an unverified email", async () => {
    const g = await signIn(db, google());
    const other = await signIn(db, google({ subject: "g-evil", emailVerified: false }));
    expect(other.created).toBe(true);
    expect(other.user.id).not.toBe(g.user.id);
    expect(other.user.email).toBeNull();
  });

  it("fills in a name Apple only sends on later re-authorization", async () => {
    const a = await signIn(db, { provider: "apple", subject: "a-1", email: "x@privaterelay.appleid.com", emailVerified: true, name: null, avatarUrl: null });
    const again = await signIn(db, { provider: "apple", subject: "a-1", email: "x@privaterelay.appleid.com", emailVerified: true, name: "Ada L", avatarUrl: null });
    expect(again.user).toMatchObject({ id: a.user.id, name: "Ada L" });
  });
});

describe("Anthropic key storage", () => {
  it("stores the key encrypted, with only a short hint in the clear", async () => {
    const { user } = await signIn(db, google());
    const updated = await setAnthropicKey(db, user.id, "sk-ant-api03-SECRETVALUE-wxyz", SECRET);
    expect(updated).toMatchObject({ hasAnthropicKey: true, anthropicKeyHint: "wxyz" });
    const { rows } = await db.query<{ anthropic_key_enc: string }>("select anthropic_key_enc from users where id = $1", [user.id]);
    expect(rows[0].anthropic_key_enc).not.toContain("SECRETVALUE");
    expect(await getAnthropicKey(db, user.id, SECRET)).toBe("sk-ant-api03-SECRETVALUE-wxyz");
    expect(JSON.stringify(updated)).not.toContain("SECRETVALUE");
  });

  it("removes the key", async () => {
    const { user } = await signIn(db, google());
    await setAnthropicKey(db, user.id, "sk-ant-1234", SECRET);
    const cleared = await setAnthropicKey(db, user.id, null, SECRET);
    expect(cleared).toMatchObject({ hasAnthropicKey: false, anthropicKeyHint: null });
    expect(await getAnthropicKey(db, user.id, SECRET)).toBeNull();
  });
});

describe("adoptServerKey", () => {
  const opts = { ownerEmail: "Jeff@example.com", serverKey: "sk-ant-server-key-0000", secret: SECRET };

  it("hands the server key to the owner's account", async () => {
    const { user } = await signIn(db, google());
    const adopted = await adoptServerKey(db, user, opts);
    expect(adopted.hasAnthropicKey).toBe(true);
    expect(await getAnthropicKey(db, user.id, SECRET)).toBe("sk-ant-server-key-0000");
  });

  it("does not give it to anyone else", async () => {
    const { user } = await signIn(db, google({ subject: "g-2", email: "someone@example.com" }));
    expect((await adoptServerKey(db, user, opts)).hasAnthropicKey).toBe(false);
  });

  it("does not match an unverified claim to the owner's email", async () => {
    const { user } = await signIn(db, google({ subject: "g-3", emailVerified: false }));
    expect((await adoptServerKey(db, user, opts)).hasAnthropicKey).toBe(false);
  });

  it("never overwrites a key the owner set themselves", async () => {
    const { user } = await signIn(db, google());
    const own = await setAnthropicKey(db, user.id, "sk-ant-my-own-1111", SECRET);
    await adoptServerKey(db, own, opts);
    expect(await getAnthropicKey(db, user.id, SECRET)).toBe("sk-ant-my-own-1111");
  });

  it("does nothing once the server key is removed or no owner is configured", async () => {
    const { user } = await signIn(db, google());
    expect((await adoptServerKey(db, user, { ...opts, serverKey: undefined })).hasAnthropicKey).toBe(false);
    expect((await adoptServerKey(db, user, { ...opts, ownerEmail: undefined })).hasAnthropicKey).toBe(false);
  });
});

describe("sessions", () => {
  it("stores only a hash of the token", async () => {
    const { user } = await signIn(db, google());
    const token = await createSession(db, user.id);
    const { rows } = await db.query<{ id: string }>("select id from sessions");
    expect(rows[0].id).toBe(sha256(token));
    expect(rows[0].id).not.toBe(token);
    expect((await validateSession(db, token))?.id).toBe(user.id);
  });

  it("rejects unknown, expired and deleted sessions", async () => {
    const { user } = await signIn(db, google());
    expect(await validateSession(db, "nope")).toBeNull();
    const old = await createSession(db, user.id, Date.now() - SESSION_TTL_MS - 1000);
    expect(await validateSession(db, old)).toBeNull();
    const t = await createSession(db, user.id);
    await deleteSession(db, t);
    expect(await validateSession(db, t)).toBeNull();
  });

  it("extends sessions that are in use", async () => {
    const { user } = await signIn(db, google());
    const started = Date.now() - 20 * 24 * 3600 * 1000; // 10 days left
    const token = await createSession(db, user.id, started);
    await validateSession(db, token);
    const { rows } = await db.query<{ expires_at: Date }>("select expires_at from sessions");
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it("goes away with the user", async () => {
    const { user } = await signIn(db, google());
    const token = await createSession(db, user.id);
    await db.query("delete from users where id = $1", [user.id]);
    expect(await validateSession(db, token)).toBeNull();
  });
});

describe("secrets", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("hello", SECRET);
    expect(a).not.toBe(encryptSecret("hello", SECRET));
    expect(decryptSecret(a, SECRET)).toBe("hello");
  });

  it("detects tampering and the wrong secret", () => {
    const sealed = encryptSecret("hello", SECRET);
    const parts = sealed.split(".");
    parts[3] = Buffer.from("jello").toString("base64url");
    expect(() => decryptSecret(parts.join("."), SECRET)).toThrow();
    expect(() => decryptSecret(sealed, "other-secret")).toThrow();
    expect(() => decryptSecret("garbage", SECRET)).toThrow("Unrecognized secret format");
  });
});

describe("openDb on disk", () => {
  it("creates the data directory and keeps data across restarts", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { openDb } = await import("./db.ts");
    const dir = join(mkdtempSync(join(tmpdir(), "orator-db-")), "nested", "pglite");
    const first = await openDb({ dataDir: dir });
    await first.query("insert into users (id, email) values ('u1', 'a@b.c')");
    await first.close();
    const second = await openDb({ dataDir: dir });
    expect((await second.query("select email from users")).rows).toEqual([{ email: "a@b.c" }]);
    await second.close();
  });
});
