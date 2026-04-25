import { TARGET_CURRENCIES, parseRates } from "./lib/rates.js";

const API_URL = "https://api.nbrb.by/exrates/rates?periodicity=0";
const ALARM_NAME = "nbrb-rates-refresh";
const ALARM_INTERVAL_MINUTES = 240;
const FETCH_TIMEOUT_MS = 10000;

let fetchInProgress = null;

async function fetchRates({ force = false } = {}) {
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

async function ensureAlarm() {
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
  if (message.action === "refreshRates") {
    fetchRates({ force: true }).then(sendResponse);
    return true;
  }

  if (message.action === "getRates") {
    browser.storage.local.get(["ratesData", "lastError"]).then(sendResponse);
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
