export const AUTH_COOKIE = "sb_auth";

// Cookie value = SHA-256 of the site password, so the password itself is never stored client-side.
export async function authToken(password: string) {
  const data = new TextEncoder().encode(`notion-sprint-board:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function passwordRequired() {
  return Boolean(process.env.SITE_PASSWORD) || process.env.NODE_ENV === "production";
}
