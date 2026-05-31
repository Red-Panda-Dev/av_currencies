import type { Env } from "./types";

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(new Uint8Array(digest));
}

export async function getIdentityHash(
  request: Request,
  env: Env,
): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const userAgent = request.headers.get("User-Agent") || "";
  const salt = await env.IDENTITY_SALT.get();
  if (!salt) {
    throw new Error("IDENTITY_SALT secret is not configured");
  }
  return sha256Hex(`${salt}:${ip}:${userAgent}`);
}
