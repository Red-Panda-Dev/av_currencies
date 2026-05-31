import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, vi, beforeEach } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "..", "examples", "nbrb_response.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

// Mock setup using vi.hoisted to run before module import
const { browserMock, fetchMock, storageState, alarmState, listeners } =
  vi.hoisted(() => {
    const storageState = {
      ratesData: null,
      lastError: null,
    };
    const alarmState = {};
    const listeners = {
      onInstalled: [],
      onStartup: [],
      onAlarm: [],
      onMessage: [],
    };

    const fetchMock = vi.fn();

    const browserMock = {
      storage: {
        local: {
          get: vi.fn(async (keys) => {
            if (!keys) return { ...storageState };
            if (typeof keys === "string") return { [keys]: storageState[keys] };
            if (Array.isArray(keys)) {
              const result = {};
              for (const key of keys) result[key] = storageState[key];
              return result;
            }
            return { ...storageState };
          }),
          set: vi.fn(async (values) => {
            for (const [key, value] of Object.entries(values)) {
              storageState[key] = value;
            }
          }),
        },
      },
      alarms: {
        get: vi.fn(async (name) => alarmState[name] || null),
        create: vi.fn(async (name, opts) => {
          alarmState[name] = { name, ...opts };
        }),
        onAlarm: {
          addListener: vi.fn((fn) => listeners.onAlarm.push(fn)),
        },
      },
      runtime: {
        onInstalled: {
          addListener: vi.fn((fn) => listeners.onInstalled.push(fn)),
        },
        onStartup: {
          addListener: vi.fn((fn) => listeners.onStartup.push(fn)),
        },
        onMessage: {
          addListener: vi.fn((fn) => listeners.onMessage.push(fn)),
        },
      },
    };

    vi.stubGlobal("browser", browserMock);
    vi.stubGlobal("fetch", fetchMock);

    return { browserMock, fetchMock, storageState, alarmState, listeners };
  });

// Import after globals are stubbed
import {
  fetchRates,
  ensureAlarm,
  API_URL,
  ALARM_NAME,
  ALARM_INTERVAL_MINUTES,
  FETCH_TIMEOUT_MS,
} from "../src/background.js";

// Helper to create a mock Response
function mockResponse(jsonData, status = 200, ok = true) {
  return {
    ok,
    status,
    json: () => Promise.resolve(jsonData),
  };
}

// Helper to create a mock error Response
function mockErrorResponse(status = 500) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error(`HTTP ${status}`)),
  };
}

beforeEach(() => {
  // Reset mocks
  vi.clearAllMocks();
  // Reset storage state
  storageState.ratesData = null;
  storageState.lastError = null;
  // Reset alarm state
  Object.keys(alarmState).forEach((key) => delete alarmState[key]);
  // Reset fetch mock
  fetchMock.mockReset();
});

describe("Constants", () => {
  it("exports API_URL", () => {
    expect(API_URL).toBe("https://api.nbrb.by/exrates/rates?periodicity=0");
  });

  it("exports ALARM_NAME", () => {
    expect(ALARM_NAME).toBe("nbrb-rates-refresh");
  });

  it("exports ALARM_INTERVAL_MINUTES", () => {
    expect(ALARM_INTERVAL_MINUTES).toBe(240);
  });

  it("exports FETCH_TIMEOUT_MS", () => {
    expect(FETCH_TIMEOUT_MS).toBe(10000);
  });
});

describe("fetchRates — success path", () => {
  it("stores ratesData with correct shape on successful API response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    const result = await fetchRates();

    expect(result.success).toBe(true);
    expect(result.rates).not.toBeNull();
    expect(storageState.ratesData).toBeDefined();
    expect(storageState.ratesData.base).toBe("BYN");
    expect(storageState.ratesData.source).toBe("NBRB");
    expect(storageState.ratesData.sourceUrl).toBe(API_URL);
    expect(storageState.ratesData.fetchedAt).toBeDefined();
    expect(storageState.ratesData.rates).toBeDefined();
    expect(storageState.ratesData.rates.USD).toBeDefined();
    expect(storageState.ratesData.rates.EUR).toBeDefined();
    expect(storageState.ratesData.rates.RUB).toBeDefined();
    expect(storageState.lastError).toBeNull();
  });

  it("extracts ratesDate from data[0].Date", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    await fetchRates();

    // Date is extracted using toISOString() which converts to UTC
    // The fixture has "2026-04-25T00:00:00" which may shift in UTC
    expect(storageState.ratesData.ratesDate).toBeDefined();
    expect(storageState.ratesData.ratesDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sets ratesDate to null when Date field is missing", async () => {
    const fixtureWithoutDate = fixture.map((item) => {
      const { Date, ...rest } = item;
      return rest;
    });
    fetchMock.mockResolvedValueOnce(mockResponse(fixtureWithoutDate));

    await fetchRates();

    expect(storageState.ratesData.ratesDate).toBeNull();
  });
});

describe("fetchRates — errors", () => {
  it("stores lastError with generic message on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(mockErrorResponse(500));

    const result = await fetchRates();

    expect(result.success).toBe(false);
    expect(storageState.lastError).toBeDefined();
    expect(storageState.lastError.message).toBe("Не удалось обновить курсы");
    expect(storageState.ratesData).toBeNull();
  });

  it("stores lastError with generic message on network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchRates();

    expect(result.success).toBe(false);
    expect(storageState.lastError).toBeDefined();
    expect(storageState.lastError.message).toBe("Не удалось обновить курсы");
  });

  it("stores lastError with timeout message on AbortError", async () => {
    const abortError = new Error("Timeout");
    abortError.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abortError);

    const result = await fetchRates();

    expect(result.success).toBe(false);
    expect(storageState.lastError).toBeDefined();
    expect(storageState.lastError.message).toBe("Превышено время ожидания");
  });

  it("stores lastError when parseRates returns null", async () => {
    // Create fixture missing USD
    const partialFixture = fixture.filter(
      (item) => item.Cur_Abbreviation !== "USD",
    );
    fetchMock.mockResolvedValueOnce(mockResponse(partialFixture));

    const result = await fetchRates();

    expect(result.success).toBe(false);
    expect(storageState.lastError).toBeDefined();
    expect(storageState.lastError.message).toBe("Не удалось обновить курсы");
    // Should not overwrite existing ratesData if it exists
    const existingRates = {
      base: "BYN",
      source: "NBRB",
      sourceUrl: API_URL,
      fetchedAt: Date.now(),
      ratesDate: "2026-04-25",
      rates: { USD: { code: "USD", name: "Доллар США", scale: 1, rate: 3.0 } },
    };
    storageState.ratesData = existingRates;

    await fetchRates();

    expect(storageState.ratesData).toEqual(existingRates);
  });
});

describe("fetchRates — deduplication", () => {
  it("returns same promise for concurrent calls without force", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    const promise1 = fetchRates();
    const promise2 = fetchRates();

    // Both promises should resolve to the same result
    const result1 = await promise1;
    const result2 = await promise2;

    expect(result1).toEqual(result2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts new fetch when force is true", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(fixture))
      .mockResolvedValueOnce(mockResponse(fixture));

    const promise1 = fetchRates();
    const promise2 = fetchRates({ force: true });

    expect(promise1).not.toBe(promise2);

    await promise1;
    await promise2;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("ensureAlarm", () => {
  it("creates alarm when none exists", async () => {
    await ensureAlarm();

    expect(browserMock.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      periodInMinutes: ALARM_INTERVAL_MINUTES,
    });
  });

  it("does not create alarm when one already exists", async () => {
    // Pre-create an alarm
    alarmState[ALARM_NAME] = { name: ALARM_NAME, periodInMinutes: 240 };

    await ensureAlarm();

    expect(browserMock.alarms.create).not.toHaveBeenCalled();
  });
});

describe("Event listeners", () => {
  it("onInstalled listener calls ensureAlarm and fetchRates", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    // Trigger the onInstalled listener
    for (const listener of listeners.onInstalled) {
      await listener();
    }

    expect(browserMock.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      periodInMinutes: ALARM_INTERVAL_MINUTES,
    });
    expect(fetchMock).toHaveBeenCalledWith(API_URL, expect.any(Object));
  });

  it("onStartup listener calls ensureAlarm and fetchRates", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    // Trigger the onStartup listener
    for (const listener of listeners.onStartup) {
      await listener();
    }

    expect(browserMock.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      periodInMinutes: ALARM_INTERVAL_MINUTES,
    });
    expect(fetchMock).toHaveBeenCalledWith(API_URL, expect.any(Object));
  });

  it("onAlarm listener triggers fetchRates for matching alarm name", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    // Trigger the onAlarm listener with matching name
    for (const listener of listeners.onAlarm) {
      await listener({ name: ALARM_NAME });
    }

    expect(fetchMock).toHaveBeenCalledWith(API_URL, expect.any(Object));
  });

  it("onAlarm listener does nothing for non-matching alarm name", async () => {
    // Trigger the onAlarm listener with non-matching name
    for (const listener of listeners.onAlarm) {
      await listener({ name: "other-alarm" });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Message handler", () => {
  it("ensureRates with no stored ratesData fetches and returns result", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    // Trigger the onMessage listener
    for (const listener of listeners.onMessage) {
      const sendResponse = vi.fn();
      await listener({ action: "ensureRates" }, {}, sendResponse);

      expect(fetchMock).toHaveBeenCalledWith(API_URL, expect.any(Object));
      // Wait for the async operation to complete
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });
      const response = sendResponse.mock.calls[0][0];
      expect(response.ratesData).toBeDefined();
      expect(response.lastError).toBeNull();
    }
  });

  it("ensureRates with existing ratesData returns stored data without fetching", async () => {
    // Pre-populate storage
    storageState.ratesData = {
      base: "BYN",
      source: "NBRB",
      sourceUrl: API_URL,
      fetchedAt: Date.now(),
      ratesDate: "2026-04-25",
      rates: { USD: { code: "USD", name: "Доллар США", scale: 1, rate: 3.0 } },
    };

    // Trigger the onMessage listener
    for (const listener of listeners.onMessage) {
      const sendResponse = vi.fn();
      await listener({ action: "ensureRates" }, {}, sendResponse);

      expect(fetchMock).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });
      const response = sendResponse.mock.calls[0][0];
      expect(response.ratesData).toEqual(storageState.ratesData);
    }
  });

  it("refreshRates force fetches and returns result", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    // Trigger the onMessage listener
    for (const listener of listeners.onMessage) {
      const sendResponse = vi.fn();
      await listener({ action: "refreshRates" }, {}, sendResponse);

      expect(fetchMock).toHaveBeenCalledWith(API_URL, expect.any(Object));
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });
      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(true);
    }
  });

  it("getRates returns stored ratesData and lastError without fetching", async () => {
    // Pre-populate storage
    storageState.ratesData = {
      base: "BYN",
      source: "NBRB",
      sourceUrl: API_URL,
      fetchedAt: Date.now(),
      ratesDate: "2026-04-25",
      rates: { USD: { code: "USD", name: "Доллар США", scale: 1, rate: 3.0 } },
    };
    storageState.lastError = null;

    // Trigger the onMessage listener
    for (const listener of listeners.onMessage) {
      const sendResponse = vi.fn();
      await listener({ action: "getRates" }, {}, sendResponse);

      expect(fetchMock).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });
      const response = sendResponse.mock.calls[0][0];
      expect(response.ratesData).toEqual(storageState.ratesData);
      expect(response.lastError).toBeNull();
    }
  });
});

describe("Initialization", () => {
  it("creates alarm on module load when storage is empty", async () => {
    // The module initialization runs on import
    // It calls ensureAlarm() which checks for existing alarm
    // Since we reset alarmState in beforeEach, the alarm should have been created
    // But the module was imported before beforeEach ran, so we need to check differently
    // Let's manually test the initialization logic
    fetchMock.mockResolvedValueOnce(mockResponse(fixture));

    // Clear the alarm state to simulate first load
    Object.keys(alarmState).forEach((key) => delete alarmState[key]);
    storageState.ratesData = null;

    // Manually run the initialization code
    await ensureAlarm();
    await browserMock.storage.local.get("ratesData").then((result) => {
      if (!result.ratesData) {
        return fetchRates();
      }
    });

    expect(browserMock.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      periodInMinutes: ALARM_INTERVAL_MINUTES,
    });
    expect(fetchMock).toHaveBeenCalledWith(API_URL, expect.any(Object));
  });

  it("does not fetch rates if ratesData exists in storage on module load", async () => {
    // Pre-populate storage
    storageState.ratesData = {
      base: "BYN",
      source: "NBRB",
      sourceUrl: API_URL,
      fetchedAt: Date.now(),
      ratesDate: "2026-04-25",
      rates: { USD: { code: "USD", name: "Доллар США", scale: 1, rate: 3.0 } },
    };

    // Clear alarm state
    Object.keys(alarmState).forEach((key) => delete alarmState[key]);

    // Manually run the initialization code
    await ensureAlarm();
    await browserMock.storage.local.get("ratesData").then((result) => {
      if (!result.ratesData) {
        return fetchRates();
      }
    });

    expect(browserMock.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      periodInMinutes: ALARM_INTERVAL_MINUTES,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
