// Site login (the admin account), not the workday sign in / sign out.
//
// Credentials live only in environment variables, never in the repo:
//   ADMIN_EMAIL     the admin's email
//   ADMIN_PASSWORD  the admin's password
// The session cookie is an HMAC of the credentials, so changing the password
// signs every browser out. Works in Proxy and in server actions (Web Crypto only).

export const AUTH_COOKIE = "mc_session";

export function adminCredentials() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

/** Locked in production always; locally only once credentials are set. */
export function authRequired() {
  return process.env.NODE_ENV === "production" || !!adminCredentials();
}

const enc = new TextEncoder();

export async function sessionToken(email: string, password: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_SECRET || `mc:${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`session:${email}:${password}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (hashes both sides so lengths can't leak). */
export async function safeEqual(a: string, b: string) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function isValidSession(cookie: string | undefined) {
  const creds = adminCredentials();
  if (!creds || !cookie) return false;
  return safeEqual(cookie, await sessionToken(creds.email, creds.password));
}
