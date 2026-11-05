/**
 * Postgres access. Production uses a real server (Heroku Postgres via DATABASE_URL); local dev and tests use
 * PGlite, an in-process Postgres, so nothing needs installing. Both speak the same SQL.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

const MIGRATIONS: string[] = [
  `
  create table users (
    id text primary key,
    email text,
    name text,
    avatar_url text,
    anthropic_key_enc text,
    anthropic_key_hint text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index users_email_key on users (email) where email is not null;

  create table identities (
    provider text not null,
    subject text not null,
    user_id text not null references users (id) on delete cascade,
    email text,
    created_at timestamptz not null default now(),
    primary key (provider, subject)
  );
  create index identities_user_id on identities (user_id);

  create table sessions (
    id text primary key,
    user_id text not null references users (id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  );
  create index sessions_user_id on sessions (user_id);
  `,
];

export async function migrate(db: Db) {
  await db.query("create table if not exists schema_migrations (version integer primary key, applied_at timestamptz not null default now())");
  const { rows } = await db.query<{ version: number }>("select coalesce(max(version), 0) as version from schema_migrations");
  for (let v = Number(rows[0].version) + 1; v <= MIGRATIONS.length; v++) {
    await db.query("begin");
    try {
      for (const stmt of MIGRATIONS[v - 1].split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
      await db.query("insert into schema_migrations (version) values ($1)", [v]);
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
}

/** Connect to `url` (postgres://…), or open PGlite at `dataDir` (in memory when omitted), then migrate. */
export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  let db: Db;
  if (opts.url) {
    const { default: pg } = await import("pg");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(opts.url);
    // Heroku Postgres requires TLS with a certificate Node can't verify against a public CA.
    const pool = new pg.Pool({ connectionString: opts.url, ssl: local ? undefined : { rejectUnauthorized: false }, max: 5 });
    db = {
      query: async (sql, params) => pool.query(sql, params as unknown[]),
      close: () => pool.end(),
    } as Db;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    if (opts.dataDir) (await import("node:fs")).mkdirSync(opts.dataDir, { recursive: true }); // PGlite won't create parents
    const lite = new PGlite(opts.dataDir);
    db = {
      query: (sql, params) => lite.query(sql, params),
      close: () => lite.close(),
    } as Db;
  }
  await migrate(db);
  return db;
}
