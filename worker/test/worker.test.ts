import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

class MemoryKV {
  private data = new Map<string, string>();

  async get(key: string, type?: string): Promise<any> {
    const value = this.data.get(key);
    if (value == null) return null;
    if (type === "json") return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string, _options?: unknown): Promise<void> {
    this.data.set(key, value);
  }

  keys(): string[] {
    return [...this.data.keys()];
  }
}

function createEnv(): Env {
  return {
    VIN_DATA: new MemoryKV() as unknown as KVNamespace,
    IDENTITY_SALT: { get: async () => "test-salt" },
    ALLOWED_ORIGINS: "chrome-extension://*,moz-extension://*",
  };
}

function createEnvWithKv(): { env: Env; kv: MemoryKV } {
  const kv = new MemoryKV();
  return {
    env: {
      VIN_DATA: kv as unknown as KVNamespace,
      IDENTITY_SALT: { get: async () => "test-salt" },
      ALLOWED_ORIGINS: "chrome-extension://*,moz-extension://*",
    },
    kv,
  };
}

function createRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://vin-api.redpandadev.workers.dev${path}`, {
    ...init,
    headers: {
      "User-Agent": "vitest",
      "CF-Connecting-IP": "203.0.113.10",
      Origin: "chrome-extension://abc",
      ...(init?.headers || {}),
    },
  });
}

describe("vin worker", () => {
  it("returns miss for unknown page", async () => {
    const response = await worker.fetch(
      createRequest("/api/vin/131905951"),
      createEnv(),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ exists: false, pageId: "131905951" });
  });

  it("creates and reads VIN record", async () => {
    const env = createEnv();
    const post = await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "WBA7C81040G494032",
        }),
      }),
      env,
    );
    expect(post.status).toBe(201);

    const get = await worker.fetch(createRequest("/api/vin/131905951"), env);
    expect(get.status).toBe(200);
    const data = (await get.json()) as Record<string, unknown>;
    expect(data.exists).toBe(true);
    expect(data.vin).toBe("WBA7C81040G494032");
    expect(data.pageId).toBe("131905951");
  });

  it("returns 409 for conflicting VIN", async () => {
    const env = createEnv();
    await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "WBA7C81040G494032",
        }),
      }),
      env,
    );

    const conflict = await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "WAUZZZ8K9DA123456",
        }),
      }),
      env,
    );
    expect(conflict.status).toBe(409);
  });

  it("returns 400 for invalid VIN", async () => {
    const response = await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "bad",
        }),
      }),
      createEnv(),
    );
    expect(response.status).toBe(400);
  });

  it("does not create separate read/write rate-limit keys in KV", async () => {
    const { env, kv } = createEnvWithKv();

    await worker.fetch(createRequest("/api/vin/131905951"), env);
    await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "WBA7C81040G494032",
        }),
      }),
      env,
    );

    expect(kv.keys().filter((key) => key.startsWith("rl:"))).toEqual([]);
  });

  it("handles OPTIONS preflight request", async () => {
    const response = await worker.fetch(
      createRequest("/api/vin", { method: "OPTIONS" }),
      createEnv(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://abc",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET,POST,OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "content-type",
    );
    expect(response.headers.get("access-control-max-age")).toBe("86400");
  });

  it("returns 404 for unknown route", async () => {
    const response = await worker.fetch(createRequest("/unknown"), createEnv());
    expect(response.status).toBe(404);
    const data = (await response.json()) as Record<string, unknown>;
    expect((data.error as Record<string, unknown>)?.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid pageId on GET", async () => {
    const response = await worker.fetch(
      createRequest("/api/vin/abc"),
      createEnv(),
    );
    expect(response.status).toBe(400);
    const data = (await response.json()) as Record<string, unknown>;
    expect((data.error as Record<string, unknown>)?.code).toBe(
      "INVALID_PAGE_ID",
    );
  });

  it("returns 400 for invalid JSON body on POST", async () => {
    const response = await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: "not-json",
      }),
      createEnv(),
    );
    expect(response.status).toBe(400);
    const data = (await response.json()) as Record<string, unknown>;
    expect((data.error as Record<string, unknown>)?.code).toBe("INVALID_JSON");
  });

  it("re-posting same VIN confirms write and increments submissionCount", async () => {
    const env = createEnv();
    await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "WBA7C81040G494032",
        }),
      }),
      env,
    );

    const confirm = await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "WBA7C81040G494032",
        }),
      }),
      env,
    );
    expect(confirm.status).toBe(200);
    const data = (await confirm.json()) as Record<string, unknown>;
    expect(data.exists).toBe(true);
  });

  it("GET with no Origin header returns null CORS origin", async () => {
    const req = new Request(
      "https://vin-api.redpandadev.workers.dev/api/vin/131905951",
      {
        headers: { "User-Agent": "vitest", "CF-Connecting-IP": "203.0.113.10" },
      },
    );
    const response = await worker.fetch(req, createEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("null");
  });

  it("GET with moz-extension origin returns correct CORS", async () => {
    const response = await worker.fetch(
      createRequest("/api/vin/131905951", {
        headers: { Origin: "moz-extension://xyz" },
      }),
      createEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "moz-extension://xyz",
    );
  });

  it("GET re-read by same user does not increment readConfirmations", async () => {
    const env = createEnv();
    await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: "131905951",
          pageUrl: "https://cars.av.by/bmw/7-seriya/131905951",
          vin: "WBA7C81040G494032",
        }),
      }),
      env,
    );

    const first = await worker.fetch(createRequest("/api/vin/131905951"), env);
    const firstData = (await first.json()) as Record<string, unknown>;
    const firstConfirmations = firstData.confirmations as number;

    const second = await worker.fetch(createRequest("/api/vin/131905951"), env);
    const secondData = (await second.json()) as Record<string, unknown>;
    expect(secondData.confirmations).toBe(firstConfirmations);
  });

  it("handles identity hash with missing IP and User-Agent", async () => {
    const req = new Request(
      "https://vin-api.redpandadev.workers.dev/api/vin/131905951",
    );
    const response = await worker.fetch(req, createEnv());
    expect(response.status).toBe(200);
  });

  it("accepts VIN payload linked to real AV.by fixture page (auto_card.html)", async () => {
    // pageId 130939060 and URL are from examples/auto_card.html ("publicUrl")
    // VIN prefix matches masked vinInfo.vin "LDP95C9**********" in that fixture
    const FIXTURE_PAGE_ID = "130939060";
    const FIXTURE_PAGE_URL = "https://cars.av.by/voyah/free/130939060";
    const FIXTURE_VIN = "LDP95C9ABCDE12345"; // valid 17-char, same prefix as fixture

    const env = createEnv();

    const post = await worker.fetch(
      createRequest("/api/vin", {
        method: "POST",
        body: JSON.stringify({
          pageId: FIXTURE_PAGE_ID,
          pageUrl: FIXTURE_PAGE_URL,
          vin: FIXTURE_VIN,
        }),
      }),
      env,
    );
    expect(post.status).toBe(201);
    const created = (await post.json()) as Record<string, unknown>;
    expect(created.exists).toBe(true);
    expect(created.vin).toBe(FIXTURE_VIN);
    expect(created.pageId).toBe(FIXTURE_PAGE_ID);

    const get = await worker.fetch(
      createRequest(`/api/vin/${FIXTURE_PAGE_ID}`),
      env,
    );
    expect(get.status).toBe(200);
    const fetched = (await get.json()) as Record<string, unknown>;
    expect(fetched.exists).toBe(true);
    expect(fetched.vin).toBe(FIXTURE_VIN);
    expect(fetched.pageId).toBe(FIXTURE_PAGE_ID);
  });
});
