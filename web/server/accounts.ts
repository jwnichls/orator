import { nanoid } from "nanoid";
import type { Db } from "./db.ts";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./secrets.ts";

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  hasAnthropicKey: boolean;
  /** Last few characters of the stored key, so the user can recognize it. */
  anthropicKeyHint: string | null;
}

/** What a sign-in provider tells us about the person, after we've verified the provider's response. */
export interface ProviderProfile {
  provider: "google" | "apple" | "dev";
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  anthropic_key_enc: string | null;
  anthropic_key_hint: string | null;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  avatarUrl: r.avatar_url,
  hasAnthropicKey: !!r.anthropic_key_enc,
  anthropicKeyHint: r.anthropic_key_hint,
});

export async function getUser(db: Db, id: string) {
  const { rows } = await db.query<UserRow>("select * from users where id = $1", [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/**
 * Find the account for a provider identity, creating it on first sign-in. A new identity whose verified email
 * matches an existing account is linked to it, so signing in with Google or Apple reaches the same account.
 */
export async function signIn(db: Db, p: ProviderProfile): Promise<{ user: User; created: boolean }> {
  const email = p.emailVerified && p.email ? p.email.trim().toLowerCase() : null;
  const known = await db.query<{ user_id: string }>("select user_id from identities where provider = $1 and subject = $2", [p.provider, p.subject]);
  let userId = known.rows[0]?.user_id;
  let created = false;

  if (!userId && email) {
    userId = (await db.query<{ id: string }>("select id from users where email = $1", [email])).rows[0]?.id;
  }
  if (!userId) {
    userId = nanoid();
    created = true;
    await db.query("insert into users (id, email, name, avatar_url) values ($1, $2, $3, $4)", [userId, email, p.name, p.avatarUrl]);
  } else {
    // Fill in details we didn't have (Apple only sends a name on the very first sign-in).
    await db.query(
      `update users set name = coalesce(name, $2), avatar_url = coalesce($3, avatar_url), email = coalesce(email, $4), updated_at = now()
       where id = $1`,
      [userId, p.name, p.avatarUrl, email && !(await emailTaken(db, email, userId)) ? email : null],
    );
  }
  if (!known.rows[0]) {
    await db.query("insert into identities (provider, subject, user_id, email) values ($1, $2, $3, $4)", [p.provider, p.subject, userId, p.email]);
  }
  return { user: (await getUser(db, userId))!, created };
}

async function emailTaken(db: Db, email: string, exceptUserId: string) {
  const { rows } = await db.query("select 1 from users where email = $1 and id <> $2", [email, exceptUserId]);
  return rows.length > 0;
}

// ---- The user's own Anthropic API key (encrypted at rest) ----

export async function setAnthropicKey(db: Db, userId: string, key: string | null, secret: string) {
  const enc = key ? encryptSecret(key, secret) : null;
  const hint = key ? key.slice(-4) : null;
  await db.query("update users set anthropic_key_enc = $2, anthropic_key_hint = $3, updated_at = now() where id = $1", [userId, enc, hint]);
  return (await getUser(db, userId))!;
}

export async function getAnthropicKey(db: Db, userId: string, secret: string) {
  const { rows } = await db.query<{ anthropic_key_enc: string | null }>("select anthropic_key_enc from users where id = $1", [userId]);
  const enc = rows[0]?.anthropic_key_enc;
  return enc ? decryptSecret(enc, secret) : null;
}

/**
 * One-time handover of the server's own key to its owner's account, so the server key can then be removed.
 * Applies only to the configured owner email (verified by the provider) and only while that account has no key.
 */
export async function adoptServerKey(db: Db, user: User, opts: { ownerEmail?: string; serverKey?: string; secret: string }) {
  if (!opts.ownerEmail || !opts.serverKey || user.hasAnthropicKey) return user;
  if (user.email !== opts.ownerEmail.trim().toLowerCase()) return user;
  return setAnthropicKey(db, user.id, opts.serverKey, opts.secret);
}

// ---- Sessions: random bearer token in an HttpOnly cookie; only its hash is stored ----

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_WHEN_LEFT_MS = 15 * 24 * 60 * 60 * 1000;

export async function createSession(db: Db, userId: string, now = Date.now()) {
  const token = randomToken();
  await db.query("insert into sessions (id, user_id, expires_at) values ($1, $2, $3)", [sha256(token), userId, new Date(now + SESSION_TTL_MS)]);
  return token;
}

/** The session's user, or null if unknown/expired. Sliding expiry: active sessions are extended. */
export async function validateSession(db: Db, token: string, now = Date.now()) {
  const id = sha256(token);
  const { rows } = await db.query<{ user_id: string; expires_at: Date }>("select user_id, expires_at from sessions where id = $1", [id]);
  const s = rows[0];
  if (!s) return null;
  const expires = new Date(s.expires_at).getTime();
  if (expires <= now) {
    await db.query("delete from sessions where id = $1", [id]);
    return null;
  }
  if (expires - now < RENEW_WHEN_LEFT_MS) {
    await db.query("update sessions set expires_at = $2 where id = $1", [id, new Date(now + SESSION_TTL_MS)]);
  }
  return getUser(db, s.user_id);
}

export async function deleteSession(db: Db, token: string) {
  await db.query("delete from sessions where id = $1", [sha256(token)]);
}
