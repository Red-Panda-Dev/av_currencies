const PAGE_ID_REGEX = /^\d{6,12}$/;
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;
const AVBY_URL_REGEX =
  /^https:\/\/(?:cars\.)?av\.by\/[a-z0-9-]+\/[a-z0-9-]+\/(\d{6,12})(?:\/|$)/i;

export function normalizeVin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const vin = value.trim().toUpperCase();
  if (!VIN_REGEX.test(vin)) return null;
  return vin;
}

export function normalizePageId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const pageId = String(value).trim();
  if (!PAGE_ID_REGEX.test(pageId)) return null;
  return pageId;
}

export function isValidPageUrl(
  value: unknown,
  expectedPageId?: string,
): boolean {
  if (typeof value !== "string") return false;
  const match = value.trim().match(AVBY_URL_REGEX);
  if (!match) return false;
  if (!expectedPageId) return true;
  return match[1] === expectedPageId;
}

export function readJsonBody<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
