import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, "..", "content", "avby.js");
const indexFixturePath = join(__dirname, "..", "examples", "index.html");
const autoCardFixturePath = join(__dirname, "..", "examples", "auto_card.html");

const contentScriptSource = readFileSync(scriptPath, "utf-8");
const indexFixture = readFileSync(indexFixturePath, "utf-8");
const autoCardFixture = readFileSync(autoCardFixturePath, "utf-8");

const sampleRates = {
  rates: {
    USD: { rate: 2.8186, scale: 1 },
    EUR: { rate: 3.2937, scale: 1 },
    RUB: { rate: 3.7556, scale: 100 },
  },
};

function createBrowserMock(initialState = {}, options = {}) {
  const state = { ...initialState };
  const listeners = [];
  const runtimeMessages = [];
  const ensureRatesResponse = options.ensureRatesResponse;

  return {
    state,
    runtimeMessages,
    browser: {
      storage: {
        local: {
          async get(keys) {
            if (!keys) return { ...state };

            if (typeof keys === "string") {
              return { [keys]: state[keys] };
            }

            if (Array.isArray(keys)) {
              const result = {};
              for (const key of keys) {
                result[key] = state[key];
              }
              return result;
            }

            return { ...state };
          },
          async set(values) {
            const changes = {};

            for (const [key, newValue] of Object.entries(values)) {
              changes[key] = {
                oldValue: state[key],
                newValue,
              };
              state[key] = newValue;
            }

            for (const listener of listeners) {
              listener(changes, "local");
            }
          },
        },
        onChanged: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
      runtime: {
        async sendMessage(message) {
          runtimeMessages.push(message);

          if (message?.action === "ensureRates") {
            if (ensureRatesResponse) {
              return ensureRatesResponse;
            }

            return {
              ratesData: state.ratesData || null,
              lastError: state.lastError || null,
            };
          }

          return null;
        },
      },
    },
  };
}

async function flushTicks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function bootstrapContentScript(html, initialState, options = {}) {
  const dom = new JSDOM(html, {
    url: "https://av.by/",
    runScripts: "outside-only",
  });

  const browserMock = createBrowserMock(initialState, options);
  const { window } = dom;

  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.browser = browserMock.browser;

  const previousGlobals = {
    window: global.window,
    document: global.document,
    browser: global.browser,
    NodeFilter: global.NodeFilter,
    MutationObserver: global.MutationObserver,
    requestAnimationFrame: global.requestAnimationFrame,
  };

  global.window = window;
  global.document = window.document;
  global.browser = browserMock.browser;
  global.NodeFilter = window.NodeFilter;
  global.MutationObserver = window.MutationObserver;
  global.requestAnimationFrame = window.requestAnimationFrame;

  window.eval(contentScriptSource);
  await flushTicks();

  const cleanup = () => {
    dom.window.close();
    global.window = previousGlobals.window;
    global.document = previousGlobals.document;
    global.browser = previousGlobals.browser;
    global.NodeFilter = previousGlobals.NodeFilter;
    global.MutationObserver = previousGlobals.MutationObserver;
    global.requestAnimationFrame = previousGlobals.requestAnimationFrame;
  };

  return { dom, browserMock, cleanup };
}

describe("av.by content script", () => {
  it("converts listing and salon prices in index fixture", async () => {
    const env = await bootstrapContentScript(indexFixture, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const listingPrice = env.dom.window.document.querySelector(
        ".listing-index__price",
      );
      expect(listingPrice).not.toBeNull();
      expect(listingPrice.textContent).toContain("$");
      expect(listingPrice.dataset.avCurrenciesOriginalText).toContain("р.");

      const salonPrice = env.dom.window.document.querySelector(
        ".salon-listing-top__prices > div",
      );
      expect(salonPrice).not.toBeNull();
      expect(salonPrice.textContent).toContain("$");

      const salonWrapper = env.dom.window.document.querySelector(
        ".salon-listing-top__prices",
      );
      expect(salonWrapper.textContent).toContain("от");
    } finally {
      env.cleanup();
    }
  });

  it("converts detail page prices and monthly payment text", async () => {
    const env = await bootstrapContentScript(autoCardFixture, {
      ratesData: sampleRates,
      selectedCurrency: "EUR",
    });

    try {
      const cardPrice = env.dom.window.document.querySelector(
        ".card__price-button",
      );
      const similarPrice = env.dom.window.document.querySelector(
        ".listing-top__price-primary",
      );
      const featuredPrice = env.dom.window.document.querySelector(
        ".featured__price-value strong",
      );

      expect(cardPrice.textContent).toContain("€");
      expect(similarPrice.textContent).toContain("€");
      expect(featuredPrice.textContent).toContain("€");

      const monthlyNode = env.dom.window.document.createElement("div");
      monthlyNode.textContent = "1386 BYN в месяц";
      env.dom.window.document.body.append(monthlyNode);

      await flushTicks();
      expect(monthlyNode.textContent).toContain("€ в месяц");
    } finally {
      env.cleanup();
    }
  });

  it("restores original BYN text when currency switches back to BYN", async () => {
    const env = await bootstrapContentScript(indexFixture, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const listingPrice = env.dom.window.document.querySelector(
        ".listing-index__price",
      );
      const originalText = listingPrice.dataset.avCurrenciesOriginalText;

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(listingPrice.textContent).toBe(originalText);
    } finally {
      env.cleanup();
    }
  });

  it("re-converts from original BYN amount when switching currencies", async () => {
    const env = await bootstrapContentScript(indexFixture, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const listingPrice = env.dom.window.document.querySelector(
        ".listing-index__price",
      );
      const bynAmount = Number.parseFloat(
        listingPrice.dataset.avCurrenciesBynAmount,
      );
      const expectedEur = `${new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 0,
      }).format(Math.round((bynAmount * 1) / sampleRates.rates.EUR.rate))} €`;

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "EUR",
      });
      await flushTicks();

      expect(listingPrice.textContent).toBe(expectedEur);
    } finally {
      env.cleanup();
    }
  });

  it("keeps original text when rates are unavailable", async () => {
    const env = await bootstrapContentScript(indexFixture, {
      selectedCurrency: "USD",
    });

    try {
      const listingPrice = env.dom.window.document.querySelector(
        ".listing-index__price",
      );
      expect(listingPrice.textContent).toContain("р.");
    } finally {
      env.cleanup();
    }
  });

  it("converts prices for dynamically added listing nodes", async () => {
    const env = await bootstrapContentScript("<html><body></body></html>", {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const dynamicPrice = env.dom.window.document.createElement("div");
      dynamicPrice.className = "listing-index__price";
      dynamicPrice.textContent = "72 990 р.";
      env.dom.window.document.body.append(dynamicPrice);

      await flushTicks();

      expect(dynamicPrice.textContent).toContain("$");
      expect(dynamicPrice.dataset.avCurrenciesOriginalText).toBe("72 990 р.");
    } finally {
      env.cleanup();
    }
  });

  it("restores monthly text after switching back to BYN", async () => {
    const env = await bootstrapContentScript("<html><body></body></html>", {
      ratesData: sampleRates,
      selectedCurrency: "EUR",
    });

    try {
      const monthlyNode = env.dom.window.document.createElement("div");
      monthlyNode.textContent = "1386 BYN в месяц";
      env.dom.window.document.body.append(monthlyNode);

      await flushTicks();
      expect(monthlyNode.textContent).toContain("€ в месяц");

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(monthlyNode.textContent).toBe("1386 BYN в месяц");
    } finally {
      env.cleanup();
    }
  });

  it("requests missing rates from background via ensureRates", async () => {
    const env = await bootstrapContentScript(
      "<html><body><div class='listing-index__price'>72 990 р.</div></body></html>",
      {
        selectedCurrency: "USD",
      },
      {
        ensureRatesResponse: {
          ratesData: sampleRates,
          lastError: null,
        },
      },
    );

    try {
      await flushTicks(6);

      const listingPrice = env.dom.window.document.querySelector(
        ".listing-index__price",
      );
      expect(listingPrice.textContent).toContain("$");
      expect(env.browserMock.runtimeMessages).toContainEqual({
        action: "ensureRates",
      });
    } finally {
      env.cleanup();
    }
  });
});
