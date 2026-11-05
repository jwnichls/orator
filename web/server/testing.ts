// Helpers for server tests.
import { openDb, type Db } from "./db.ts";

/** A fresh in-memory Postgres (PGlite) with the schema applied. */
export const testDb = () => openDb();

export async function resetDb(db: Db) {
  await db.query("truncate sessions, identities, users cascade");
}

/** Pull `name=value` pairs out of a response's Set-Cookie headers. */
export function cookiesFrom(res: Response) {
  const out: Record<string, { value: string; attrs: string }> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";");
    const i = pair.indexOf("=");
    out[pair.slice(0, i).trim()] = { value: pair.slice(i + 1), attrs: attrs.join(";").trim() };
  }
  return out;
}
