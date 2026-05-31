import { getIdentityHash } from "./crypto";
import {
  confirmRead,
  confirmWrite,
  createRecord,
  getRecord,
  putRecord,
  toVinResponse,
} from "./storage";
import type { Env } from "./types";
import {
  isValidPageUrl,
  normalizePageId,
  normalizeVin,
  readJsonBody,
} from "./validation";

function getAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim());
  if (allowed.includes("*")) return "*";
  if (
    origin.startsWith("chrome-extension://") &&
    allowed.includes("chrome-extension://*")
  ) {
    return origin;
  }
  if (
    origin.startsWith("moz-extension://") &&
    allowed.includes("moz-extension://*")
  ) {
    return origin;
  }
  return "null";
}

function json(
  data: unknown,
  init: ResponseInit = {},
  request?: Request,
  env?: Env,
): Response {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  if (request && env) {
    headers.set("access-control-allow-origin", getAllowedOrigin(request, env));
    headers.set("vary", "Origin");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function jsonError(
  code: string,
  message: string,
  status: number,
  request: Request,
  env: Env,
): Response {
  return json({ error: { code, message } }, { status }, request, env);
}

function preflight(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": getAllowedOrigin(request, env),
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}

async function handleGetVin(
  request: Request,
  env: Env,
  pageIdRaw: string,
): Promise<Response> {
  const pageId = normalizePageId(pageIdRaw);
  if (!pageId)
    return jsonError(
      "INVALID_PAGE_ID",
      "Некорректный pageId",
      400,
      request,
      env,
    );

  const identityHash = await getIdentityHash(request, env);
  const existing = await getRecord(env, pageId);
  if (!existing)
    return json({ exists: false, pageId }, { status: 200 }, request, env);

  const updated = confirmRead(existing, identityHash, new Date().toISOString());
  if (updated !== existing) {
    await putRecord(env, updated);
  }
  return json(toVinResponse(updated), { status: 200 }, request, env);
}

async function handlePostVin(request: Request, env: Env): Promise<Response> {
  const body = readJsonBody<{
    pageId?: unknown;
    pageUrl?: unknown;
    vin?: unknown;
  }>(await request.text());
  if (!body)
    return jsonError("INVALID_JSON", "Некорректный JSON", 400, request, env);

  const pageId = normalizePageId(body.pageId);
  const vin = normalizeVin(body.vin);
  const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl.trim() : "";
  if (!pageId || !vin || !isValidPageUrl(pageUrl, pageId)) {
    return jsonError(
      "INVALID_PAYLOAD",
      "Некорректные данные VIN",
      400,
      request,
      env,
    );
  }

  const identityHash = await getIdentityHash(request, env);
  const nowIso = new Date().toISOString();
  const existing = await getRecord(env, pageId);

  if (!existing) {
    const record = createRecord({ pageId, pageUrl, vin, identityHash, nowIso });
    await putRecord(env, record);
    return json(toVinResponse(record), { status: 201 }, request, env);
  }

  if (existing.vin !== vin) {
    return jsonError(
      "VIN_CONFLICT",
      "VIN уже сохранен и отличается",
      409,
      request,
      env,
    );
  }

  const updated = confirmWrite(existing, identityHash, nowIso);
  await putRecord(env, updated);
  return json(toVinResponse(updated), { status: 200 }, request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return preflight(request, env);

    if (request.method === "GET" && url.pathname.startsWith("/api/vin/")) {
      return handleGetVin(request, env, url.pathname.replace("/api/vin/", ""));
    }

    if (request.method === "POST" && url.pathname === "/api/vin") {
      return handlePostVin(request, env);
    }

    return jsonError("NOT_FOUND", "Маршрут не найден", 404, request, env);
  },
};
