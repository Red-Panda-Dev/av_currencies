globalThis.browser ??= globalThis.chrome;

import { TARGET_CURRENCIES, parseRates } from "./lib/rates.js";

export const API_URL = "https://api.nbrb.by/exrates/rates?periodicity=0";
export const ALARM_NAME = "nbrb-rates-refresh";
export const ALARM_INTERVAL_MINUTES = 240;
export const FETCH_TIMEOUT_MS = 10000;
export const VIN_WORKER_API_BASE = "https://avby.currencies-bel.top";

let fetchInProgress = null;

function normalizePageId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const pageId = String(value).trim();
  return /^\d{6,12}$/.test(pageId) ? pageId : null;
}

function normalizeVin(value) {
  if (typeof value !== "string") return null;
  const vin = value.trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchVinForPage(pageId) {
  const normalizedPageId = normalizePageId(pageId);
  if (!normalizedPageId) {
    return {
      success: false,
      error: { code: "INVALID_PAGE_ID", message: "Некорректный pageId" },
    };
  }

  try {
    const response = await fetchWithTimeout(
      `${VIN_WORKER_API_BASE}/api/vin/${normalizedPageId}`,
    );
    const payload = await response.json();
    if (!response.ok) {
      return { success: false, error: payload.error || { code: "HTTP_ERROR" } };
    }
    return { success: true, data: payload };
  } catch (error) {
    return {
      success: false,
      error: {
        code: error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
        message: "Не удалось получить VIN",
      },
    };
  }
}

export async function submitVinForPage({ pageId, pageUrl, vin }) {
  const normalizedPageId = normalizePageId(pageId);
  const normalizedVin = normalizeVin(vin);
  if (!normalizedPageId || !normalizedVin || typeof pageUrl !== "string") {
    return {
      success: false,
      error: { code: "INVALID_PAYLOAD", message: "Некорректные данные VIN" },
    };
  }

  try {
    const response = await fetchWithTimeout(`${VIN_WORKER_API_BASE}/api/vin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageId: normalizedPageId,
        pageUrl,
        vin: normalizedVin,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      return { success: false, error: payload.error || { code: "HTTP_ERROR" } };
    }
    return { success: true, data: payload };
  } catch (error) {
    return {
      success: false,
      error: {
        code: error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
        message: "Не удалось отправить VIN",
      },
    };
  }
}

export async function fetchRates({ force = false } = {}) {
  if (fetchInProgress && !force) return fetchInProgress;

  fetchInProgress = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const resp = await fetch(API_URL, { signal: controller.signal });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const rates = parseRates(data);

      if (!rates) {
        throw new Error("Invalid response: missing required currencies");
      }

      const ratesDate = data[0]?.Date
        ? new Date(data[0].Date).toISOString().slice(0, 10)
        : null;

      await browser.storage.local.set({
        ratesData: {
          base: "BYN",
          source: "NBRB",
          sourceUrl: API_URL,
          fetchedAt: Date.now(),
          ratesDate,
          rates,
        },
        lastError: null,
      });

      return { success: true, rates };
    } catch (err) {
      clearTimeout(timer);

      await browser.storage.local.set({
        lastError: {
          message:
            err.name === "AbortError"
              ? "\u041f\u0440\u0435\u0432\u044b\u0448\u0435\u043d\u043e \u0432\u0440\u0435\u043c\u044f \u043e\u0436\u0438\u0434\u0430\u043d\u0438\u044f"
              : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u043a\u0443\u0440\u0441\u044b",
          at: Date.now(),
        },
      });

      return { success: false, error: err };
    } finally {
      fetchInProgress = null;
    }
  })();

  return fetchInProgress;
}

export async function getEffectiveRates() {
  const { ratesData, customRates } = await browser.storage.local.get([
    "ratesData",
    "customRates",
  ]);
  if (!ratesData?.rates) return null;
  const overrides = customRates || {};
  const rates = {};
  for (const [code, info] of Object.entries(ratesData.rates)) {
    rates[code] = { ...info, rate: overrides[code] ?? info.rate };
  }
  return { ...ratesData, rates };
}

export async function ensureAlarm() {
  const alarm = await browser.alarms.get(ALARM_NAME);
  if (!alarm) {
    browser.alarms.create(ALARM_NAME, {
      periodInMinutes: ALARM_INTERVAL_MINUTES,
    });
  }
}

browser.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await fetchRates();
});

browser.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await fetchRates();
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await fetchRates();
  }
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "ensureRates") {
    browser.storage.local
      .get("ratesData")
      .then(async ({ ratesData }) => {
        if (!ratesData) {
          await fetchRates();
        }
        return browser.storage.local.get(["ratesData", "lastError"]);
      })
      .then(sendResponse);
    return true;
  }

  if (message.action === "refreshRates") {
    fetchRates({ force: true }).then(async (result) => {
      await browser.storage.local.set({ customRates: {} });
      sendResponse(result);
    });
    return true;
  }

  if (message.action === "saveCustomRate") {
    browser.storage.local.get("customRates").then(({ customRates }) => {
      const updated = {
        ...(customRates || {}),
        [message.currency]: message.rate,
      };
      browser.storage.local.set({ customRates: updated }).then(() => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.action === "clearCustomRates") {
    browser.storage.local
      .set({ customRates: {} })
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === "clearCustomRate") {
    browser.storage.local.get("customRates").then(({ customRates }) => {
      const updated = { ...(customRates || {}) };
      delete updated[message.currency];
      browser.storage.local.set({ customRates: updated }).then(() => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.action === "getCustomRates") {
    browser.storage.local.get("customRates").then(({ customRates }) => {
      sendResponse({ customRates: customRates || {} });
    });
    return true;
  }

  if (message.action === "getEffectiveRates") {
    getEffectiveRates().then(sendResponse);
    return true;
  }

  if (message.action === "getRates") {
    browser.storage.local.get(["ratesData", "lastError"]).then(sendResponse);
    return true;
  }

  if (message.action === "getVinForPage") {
    fetchVinForPage(message.pageId).then(sendResponse);
    return true;
  }

  if (message.action === "submitVinForPage") {
    submitVinForPage(message).then(sendResponse);
    return true;
  }
});

ensureAlarm().then(() => {
  browser.storage.local.get("ratesData").then((result) => {
    if (!result.ratesData) {
      fetchRates();
    }
  });
});
