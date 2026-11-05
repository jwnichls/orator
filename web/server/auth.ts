import { Apple, decodeIdToken, generateCodeVerifier, generateState, Google } from "arctic";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { adoptServerKey, createSession, deleteSession, SESSION_TTL_MS, signIn, type ProviderProfile } from "./accounts.ts";
import type { Db } from "./db.ts";

export const SESSION_COOKIE = "orator_session";
const FLOW_COOKIE_MAX_AGE = 10 * 60;

/** A sign-in provider: builds the authorization URL and turns the callback's code into a verified profile. */
export interface OAuthProvider {
  authorizeUrl(redirectUri: string, state: string, codeVerifier: string): URL;
  exchange(redirectUri: string, code: string, codeVerifier: string, extra?: { user?: string }): Promise<ProviderProfile>;
}

export interface AuthOptions {
  db: Db;
  providers: { google?: OAuthProvider; apple?: OAuthProvider };
  /** Local development only: sign in without a provider (as `devLoginEmail`, or an `?email=` override). */
  allowDevLogin?: boolean;
  devLoginEmail?: string;
  /** Canonical external origin, e.g. https://www.orator-ai.com. Defaults to the request's (proxy-aware) origin. */
  publicUrl?: string;
  /** Server key handed to the owner's account on sign-in (see adoptServerKey). */
  owner?: { email?: string; serverKey?: string };
  secret: string;
}

/** The origin browsers use to reach us. Heroku terminates TLS, so trust x-forwarded-proto for the scheme. */
export function publicOrigin(c: Context, publicUrl?: string) {
  if (publicUrl) return publicUrl.replace(/\/$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  return `${proto}://${c.req.header("host") ?? url.host}`;
}

const isSecure = (c: Context, opts: AuthOptions) => publicOrigin(c, opts.publicUrl).startsWith("https:");

export function setSessionCookie(c: Context, token: string, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, { path: "/", httpOnly: true, secure, sameSite: "Lax", maxAge: SESSION_TTL_MS / 1000 });
}

const fail = (c: Context, message: string) => c.redirect(`/?auth_error=${encodeURIComponent(message)}`, 302);

export function authRoutes(opts: AuthOptions) {
  const app = new Hono();
  const callbackUrl = (c: Context, name: string) => `${publicOrigin(c, opts.publicUrl)}/api/auth/${name}/callback`;

  const finish = async (c: Context, profile: ProviderProfile) => {
    let { user } = await signIn(opts.db, profile);
    user = await adoptServerKey(opts.db, user, { ownerEmail: opts.owner?.email, serverKey: opts.owner?.serverKey, secret: opts.secret });
    setSessionCookie(c, await createSession(opts.db, user.id), isSecure(c, opts));
    return c.redirect("/", 302);
  };

  app.get("/providers", (c) => c.json({ google: !!opts.providers.google, apple: !!opts.providers.apple, dev: !!opts.allowDevLogin }));

  for (const name of ["google", "apple"] as const) {
    const provider = opts.providers[name];
    if (!provider) continue;
    // Apple returns via a cross-site form POST, which only carries SameSite=None cookies.
    const sameSite = name === "apple" ? "None" : "Lax";
    const flowCookie = `orator_${name}_flow`;

    app.get(`/${name}`, (c) => {
      const state = generateState();
      const verifier = generateCodeVerifier();
      setCookie(c, flowCookie, `${state}.${verifier}`, {
        path: "/api/auth",
        httpOnly: true,
        secure: name === "apple" || isSecure(c, opts),
        sameSite,
        maxAge: FLOW_COOKIE_MAX_AGE,
      });
      return c.redirect(provider.authorizeUrl(callbackUrl(c, name), state, verifier).toString(), 302);
    });

    app.on(name === "apple" ? "POST" : "GET", `/${name}/callback`, async (c) => {
      const params = name === "apple" ? ((await c.req.parseBody()) as Record<string, string>) : c.req.query();
      const [expectedState, verifier] = (getCookie(c, flowCookie) ?? "").split(".");
      deleteCookie(c, flowCookie, { path: "/api/auth", secure: name === "apple" || isSecure(c, opts) });
      if (params.error) return fail(c, params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "Sign-in was cancelled." : `Sign-in failed (${params.error}).`);
      if (!params.code || !params.state || params.state !== expectedState) return fail(c, "Sign-in expired or was interrupted. Please try again.");
      let profile: ProviderProfile;
      try {
        profile = await provider.exchange(callbackUrl(c, name), params.code, verifier, { user: params.user });
      } catch (e) {
        console.error(`${name} sign-in failed`, e);
        return fail(c, "Couldn't complete sign-in. Please try again.");
      }
      return finish(c, profile);
    });
  }

  if (opts.allowDevLogin) {
    app.get("/dev", (c) => {
      const email = (c.req.query("email") || opts.devLoginEmail || "dev@localhost").toLowerCase();
      return finish(c, { provider: "dev", subject: email, email, emailVerified: true, name: c.req.query("name") || "Local developer", avatarUrl: null });
    });
  }

  app.post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(opts.db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecure(c, opts) });
    return c.json({ ok: true });
  });

  return app;
}

// ---- Real providers ----

type Claims = Record<string, unknown>;

/** The ID token comes straight from the provider's token endpoint over TLS (code flow), so we check its claims. */
function checkClaims(claims: Claims, issuers: string[], audience: string) {
  if (!issuers.includes(String(claims.iss))) throw new Error(`Unexpected issuer ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new Error("ID token audience mismatch");
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) throw new Error("ID token expired");
  if (!claims.sub) throw new Error("ID token has no subject");
}

export function googleProvider(clientId: string, clientSecret: string): OAuthProvider {
  return {
    authorizeUrl: (redirectUri, state, verifier) => {
      const url = new Google(clientId, clientSecret, redirectUri).createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
      url.searchParams.set("prompt", "select_account");
      return url;
    },
    exchange: async (redirectUri, code, verifier) => {
      const tokens = await new Google(clientId, clientSecret, redirectUri).validateAuthorizationCode(code, verifier);
      const claims = decodeIdToken(tokens.idToken()) as Claims;
      checkClaims(claims, ["https://accounts.google.com", "accounts.google.com"], clientId);
      return {
        provider: "google",
        subject: String(claims.sub),
        email: typeof claims.email === "string" ? claims.email : null,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : null,
        avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
      };
    },
  };
}

/** Apple's signing key arrives as a .p8 PEM; config vars often carry its newlines escaped. */
export function pemToPkcs8(pem: string) {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(body, "base64"));
}

export function appleProvider(cfg: { clientId: string; teamId: string; keyId: string; privateKey: string }): OAuthProvider {
  const client = (redirectUri: string) => new Apple(cfg.clientId, cfg.teamId, cfg.keyId, pemToPkcs8(cfg.privateKey), redirectUri);
  return {
    authorizeUrl: (redirectUri, state) => {
      const url = client(redirectUri).createAuthorizationURL(state, ["name", "email"]);
      url.searchParams.set("response_mode", "form_post"); // required by Apple when asking for name/email
      return url;
    },
    exchange: async (redirectUri, code, _verifier, extra) => {
      const tokens = await client(redirectUri).validateAuthorizationCode(code);
      const claims = decodeIdToken(tokens.idToken()) as Claims;
      checkClaims(claims, ["https://appleid.apple.com"], cfg.clientId);
      // Apple sends the person's name only on the first authorization, as a JSON form field.
      let name: string | null = null;
      try {
        const u = extra?.user ? (JSON.parse(extra.user) as { name?: { firstName?: string; lastName?: string } }) : undefined;
        name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(" ") || null;
      } catch {
        /* ignore malformed */
      }
      return {
        provider: "apple",
        subject: String(claims.sub),
        email: typeof claims.email === "string" ? claims.email : null,
        emailVerified: claims.email_verified === true || claims.email_verified === "true",
        name,
        avatarUrl: null,
      };
    },
  };
}
