const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function secret() {
  if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET === "replace-this-before-deployment")) throw new Error("Configure a strong SESSION_SECRET before starting production.");
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "local-development-only";
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function key() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `authenticated.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token?: string) {
  if (!token) return false;
  const [label, expires, signature, ...extra] = token.split(".");
  if (extra.length || label !== "authenticated" || !expires || !signature) return false;
  if (!Number.isSafeInteger(Number(expires)) || Number(expires) <= Math.floor(Date.now() / 1000)) return false;

  const payload = `${label}.${expires}`;
  try {
    const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), value => value.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", await key(), bytes, new TextEncoder().encode(payload));
  } catch { return false; }
}

export { SESSION_MAX_AGE };
