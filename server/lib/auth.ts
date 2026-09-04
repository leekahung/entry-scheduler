import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a staff sign-in lasts before Google is asked again. */
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const SESSION_COOKIE = "admin_session";
export const STATE_COOKIE = "admin_oauth_state";

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  /**
   * Lower-cased addresses that are always owners, from the environment.
   * They cannot be removed through the console, so a mistake in the staff
   * list can never lock everyone out.
   */
  allowed: Set<string>;
  sessionSecret: string;
  /** Fixed callback URL, or "" to derive it from the request. */
  redirectUri: string;
};

/**
 * Reads the Google sign-in settings from the environment.
 * Returns null when they are absent, which leaves the console on its shared
 * passcode rather than locking everyone out.
 */
export function authConfig(env = process.env): AuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const sessionSecret = env.SESSION_SECRET?.trim();
  if (!clientId || !clientSecret || !sessionSecret) return null;

  return {
    clientId,
    clientSecret,
    sessionSecret,
    allowed: parseAllowlist(env.ADMIN_EMAILS),
    redirectUri: env.OAUTH_REDIRECT_URI?.trim() ?? "",
  };
}

/** Comma-separated addresses, lower-cased so case can never deny a match. */
export function parseAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True for an address the environment names as a permanent owner. */
export function isBootstrapOwner(config: AuthConfig, email: string): boolean {
  return config.allowed.has(email.trim().toLowerCase());
}

const b64 = (value: string) => Buffer.from(value).toString("base64url");

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/**
 * A signed `payload.signature` token; the payload is readable, not secret.
 * The name is carried only so the console can say who is helping; nothing is
 * decided by it, and a token written before it existed still reads.
 */
export function signSession(
  email: string,
  secret: string,
  now = Date.now(),
  name = "",
): string {
  const payload = b64(
    JSON.stringify({ email, exp: now + SESSION_MS, ...(name ? { name } : {}) }),
  );
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * The email a session token carries, or null when it is forged or expired.
 * Any malformed input is a rejection rather than a throw: this runs on
 * whatever a caller chose to put in the cookie.
 */
export function readSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload, secret));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length) return null;
  if (!timingSafeEqual(expected, supplied)) return null;

  try {
    const { email, exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { email?: unknown; exp?: unknown };
    if (typeof email !== "string" || typeof exp !== "number") return null;
    return exp > now ? email : null;
  } catch {
    return null;
  }
}

/** The display name a valid session carries, or "" when it holds none. */
export function sessionName(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string {
  if (!readSession(token, secret, now)) return "";
  try {
    const [payload] = String(token).split(".");
    const { name } = JSON.parse(
      Buffer.from(String(payload), "base64url").toString(),
    ) as { name?: unknown };
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

/** Reads one cookie out of a raw Cookie header. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * A Set-Cookie value. `maxAge` of 0 clears the cookie.
 * SameSite=Lax so the cookie survives Google's redirect back but is not sent
 * from a third party's form post.
 */
export function cookie(
  name: string,
  value: string,
  { maxAge, secure }: { maxAge: number; secure: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAge / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
