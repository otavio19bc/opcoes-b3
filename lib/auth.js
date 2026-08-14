export const COOKIE_NAME = "b3auth";

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedToken() {
  const password = process.env.APP_PASSWORD || "";
  return sha256Hex(password);
}

export async function isCorrectPassword(candidate) {
  return candidate === process.env.APP_PASSWORD;
}
