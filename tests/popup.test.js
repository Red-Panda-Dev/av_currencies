// @vitest-environment jsdom
import { vi, describe, it, expect, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlSource = readFileSync(
  join(__dirname, "../src/popup/popup.html"),
  "utf-8",
);

// Full ratesData shape that matches what background.js stores
const DEFAULT_RATES = {
  rates: {
    USD: { code: "USD", name: "Доллар США", scale: 1, rate: 2.8186 },
    EUR: { code: "EUR", name: "Евро", scale: 1, rate: 3.2937 },
    RUB: {
      code: "RUB",
      name: "Российских рублей",
      scale: 100,
      rate: 3.7556,
    },
  },
  fetchedAt: Date.now(),
};

async function flushTicks(count = 6) {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Bootstrap popup.js into the current jsdom environment.
 * Sets up DOM from popup.html, stubs browser globals, then dynamically
 * imports popup.js (which runs module-level getElementById calls) and
 * fires DOMContentLoaded to trigger async initialization.
 */
async function bootstrapPopup(stateOverrides = {}) {
  const state = {
    ratesData: DEFAULT_RATES,
    lastError: null,
    selectedCurrency: "BYN",
    ...stateOverrides,
  };

  const browserMock = {
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          if (!keys) return { ...state };
          if (typeof keys === "string") return { [keys]: state[keys] };
          if (Array.isArray(keys)) {
            const result = {};
            for (const k of keys) result[k] = state[k];
            return result;
          }
          return { ...state };
        }),
        set: vi.fn(async (values) => {
          Object.assign(state, values);
        }),
      },
    },
    runtime: {
      sendMessage: vi.fn(async (msg) => {
        if (msg?.action === "getRates" || msg?.action === "refreshRates") {
          return { ratesData: state.ratesData, lastError: state.lastError };
        }
        return null;
      }),
    },
  };

  vi.stubGlobal("browser", browserMock);
  vi.stubGlobal("chrome", browserMock);

  // Inject popup.html into the current jsdom document before module loads.
  // popup.js runs document.getElementById() at module top-level; the DOM
  // must be ready by the time the module executes.
  const tmp = new JSDOM(htmlSource);
  document.head.innerHTML = tmp.window.document.head.innerHTML;
  document.body.innerHTML = tmp.window.document.body.innerHTML;

  // Clear module cache so popup.js top-level code re-runs against our DOM.
  vi.resetModules();
  await import("../src/popup/popup.js");

  // Fire DOMContentLoaded to run the async initialization handler.
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flushTicks();

  return { state, browserMock };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// VIN checkbox — read from storage
// ---------------------------------------------------------------------------

describe("popup VIN checkbox — initial state", () => {
  it("leaves checkbox unchecked when vinFeatureEnabled is absent from storage", async () => {
    const { browserMock } = await bootstrapPopup({
      vinFeatureEnabled: undefined,
    });
    const checkbox = document.getElementById("vin-feature-enabled");
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    expect(browserMock.storage.local.get).toHaveBeenCalled();
  });

  it("checks checkbox when vinFeatureEnabled is true in storage", async () => {
    await bootstrapPopup({ vinFeatureEnabled: true });
    const checkbox = document.getElementById("vin-feature-enabled");
    expect(checkbox.checked).toBe(true);
  });

  it("leaves checkbox unchecked when vinFeatureEnabled is false in storage", async () => {
    await bootstrapPopup({ vinFeatureEnabled: false });
    const checkbox = document.getElementById("vin-feature-enabled");
    expect(checkbox.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VIN checkbox — persistence
// ---------------------------------------------------------------------------

describe("popup VIN checkbox — persistence", () => {
  it("writes true to storage when checkbox is checked", async () => {
    const { state } = await bootstrapPopup({ vinFeatureEnabled: false });
    const checkbox = document.getElementById("vin-feature-enabled");

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await flushTicks();

    expect(state.vinFeatureEnabled).toBe(true);
  });

  it("writes false to storage when checkbox is unchecked", async () => {
    const { state } = await bootstrapPopup({ vinFeatureEnabled: true });
    const checkbox = document.getElementById("vin-feature-enabled");

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await flushTicks();

    expect(state.vinFeatureEnabled).toBe(false);
  });

  it("writes false (not a truthy non-boolean) when unchecked", async () => {
    const { state } = await bootstrapPopup({ vinFeatureEnabled: true });
    const checkbox = document.getElementById("vin-feature-enabled");

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await flushTicks();

    expect(state.vinFeatureEnabled).toStrictEqual(false);
  });
});

describe("popup VIN checkbox — layout and link", () => {
  it("renders VIN checkbox inside a dedicated block under settings", async () => {
    await bootstrapPopup();
    const block = document.querySelector(".settings__vin-block");
    const row = document.querySelector(".settings__vin-row");
    const checkbox = document.getElementById("vin-feature-enabled");

    expect(block).not.toBeNull();
    expect(row).not.toBeNull();
    expect(checkbox).not.toBeNull();
    expect(block.contains(row)).toBe(true);
    expect(row.contains(checkbox)).toBe(true);
  });

  it("includes link to VIN logic description with safe attributes", async () => {
    await bootstrapPopup();
    const link = document.querySelector(".settings__vin-link");

    expect(link).not.toBeNull();
    expect(link.textContent).toBe("Описание логики");
    expect(link.getAttribute("href")).toBe(
      "https://github.com/Red-Panda-Dev/av_currencies/blob/main/VIN-LOGIC.md",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});

// ---------------------------------------------------------------------------
// Display currency — sanity check that existing popup behavior is intact
// ---------------------------------------------------------------------------

describe("popup display currency initialization", () => {
  it("sets select to stored currency", async () => {
    await bootstrapPopup({ selectedCurrency: "USD" });
    const select = document.getElementById("display-currency");
    expect(select).not.toBeNull();
    expect(select.value).toBe("USD");
  });

  it("defaults to BYN when selectedCurrency is absent", async () => {
    await bootstrapPopup({ selectedCurrency: undefined });
    const select = document.getElementById("display-currency");
    expect(select.value).toBe("BYN");
  });

  it("persists new currency when select changes", async () => {
    const { state } = await bootstrapPopup({ selectedCurrency: "BYN" });
    const select = document.getElementById("display-currency");

    select.value = "EUR";
    select.dispatchEvent(new Event("change"));
    await flushTicks();

    expect(state.selectedCurrency).toBe("EUR");
  });
});
