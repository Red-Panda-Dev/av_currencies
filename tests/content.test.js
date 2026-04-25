import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, "..", "content", "avby.js");
const indexFixturePath = join(__dirname, "..", "examples", "index.html");
const autoCardFixturePath = join(__dirname, "..", "examples", "auto_card.html");
const newCarsListFixturePath = join(
  __dirname,
  "..",
  "examples",
  "new_cars_list.html",
);
const newCarPageFixturePath = join(
  __dirname,
  "..",
  "examples",
  "new_car_page.html",
);
const partsListFixturePath = join(
  __dirname,
  "..",
  "examples",
  "parts_list.html",
);

const contentScriptSource = readFileSync(scriptPath, "utf-8");
const indexFixture = readFileSync(indexFixturePath, "utf-8");
const autoCardFixture = readFileSync(autoCardFixturePath, "utf-8");
const newCarsListFixture = readFileSync(newCarsListFixturePath, "utf-8");
const newCarPageFixture = readFileSync(newCarPageFixturePath, "utf-8");
const partsListFixture = readFileSync(partsListFixturePath, "utf-8");

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

      const salonWrappers = [
        ...env.dom.window.document.querySelectorAll(
          ".salon-listing-top__prices",
        ),
      ];
      expect(salonWrappers.length).toBeGreaterThan(0);
      for (const wrapper of salonWrappers) {
        expect(wrapper.textContent).toContain("$");
        expect(wrapper.textContent).not.toMatch(/[рp]\./i);
      }

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      for (const wrapper of salonWrappers) {
        expect(wrapper.textContent).toMatch(/[рp]\./i);
      }
    } finally {
      env.cleanup();
    }
  });

  it("converts parts list prices and restores their original BYN text", async () => {
    const env = await bootstrapContentScript(partsListFixture, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const partsPrice = env.dom.window.document.querySelector(
        ".listing-item__price-primary",
      );
      expect(partsPrice).not.toBeNull();
      expect(partsPrice.textContent).toContain("$");
      expect(partsPrice.dataset.avCurrenciesOriginalText).toContain("р.");

      const featuredPartsPrice = env.dom.window.document.querySelector(
        ".listing-top__price-primary",
      );
      expect(featuredPartsPrice).not.toBeNull();
      expect(featuredPartsPrice.textContent).toContain("$");

      const originalPartsText = partsPrice.dataset.avCurrenciesOriginalText;
      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(partsPrice.textContent).toBe(originalPartsText);
    } finally {
      env.cleanup();
    }
  });

  it("converts new car listing prices and restores their original BYN text", async () => {
    const env = await bootstrapContentScript(newCarsListFixture, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const bannerPrice = env.dom.window.document.querySelector(
        ".salon-listing-model__banner-priсe",
      );
      expect(bannerPrice).not.toBeNull();
      expect(bannerPrice.textContent).toMatch(/^от\s/);
      expect(bannerPrice.textContent).toContain("$");
      expect(bannerPrice.dataset.avCurrenciesOriginalText).toContain("р.");

      const listPrices = [
        ...env.dom.window.document.querySelectorAll(
          ".salon-listing-items__item-price-byn",
        ),
      ];
      expect(listPrices.length).toBeGreaterThan(0);
      for (const price of listPrices) {
        expect(price.textContent).toContain("$");
        expect(price.dataset.avCurrenciesOriginalText).toMatch(/[рp]\./i);
      }

      const originalBannerText = bannerPrice.dataset.avCurrenciesOriginalText;
      const originalListTexts = listPrices.map(
        (price) => price.dataset.avCurrenciesOriginalText,
      );

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(bannerPrice.textContent).toBe(originalBannerText);
      for (const [index, price] of listPrices.entries()) {
        expect(price.textContent).toBe(originalListTexts[index]);
      }
    } finally {
      env.cleanup();
    }
  });

  it("converts new car detail price and restores its original BYN text", async () => {
    const env = await bootstrapContentScript(newCarPageFixture, {
      ratesData: sampleRates,
      selectedCurrency: "EUR",
    });

    try {
      const cardPrice = env.dom.window.document.querySelector(
        ".salon-card__price-primary",
      );
      expect(cardPrice).not.toBeNull();
      expect(cardPrice.textContent).toContain("€");
      expect(cardPrice.dataset.avCurrenciesOriginalText).toMatch(/[рp]\./i);

      const originalText = cardPrice.dataset.avCurrenciesOriginalText;

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(cardPrice.textContent).toBe(originalText);
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
      const cardCommercialMonthly = env.dom.window.document.querySelector(
        ".card__commercial-text > span:last-child",
      );
      const financeItemMonthly = env.dom.window.document.querySelector(
        ".finance-item__subtitle",
      );
      const financeRange =
        env.dom.window.document.querySelector(".finance-item__sum");
      const financeDate = env.dom.window.document.querySelector(
        ".finance-item__date",
      );
      const sideFinanceMonthly = env.dom.window.document.querySelector(
        ".side-finance__lead",
      );

      expect(cardPrice.textContent).toContain("€");
      expect(similarPrice.textContent).toContain("€");
      expect(featuredPrice.textContent).toContain("€");
      expect(cardCommercialMonthly.textContent).toContain("€");
      expect(cardCommercialMonthly.textContent).toContain("в");
      expect(cardCommercialMonthly.textContent).not.toContain("BYN");
      expect(financeItemMonthly.textContent).toContain("€");
      expect(financeItemMonthly.textContent).toContain("в");
      expect(financeItemMonthly.textContent).not.toContain("BYN");
      expect(financeRange.textContent).toContain("€");
      expect(financeRange.textContent).toContain("—");
      expect(financeRange.textContent).not.toContain("BYN");
      expect(financeRange.dataset.avCurrenciesOriginalText).toContain("BYN");
      expect(financeDate.textContent).toBe("13 — 84 мес.");
      expect(sideFinanceMonthly.textContent).toContain("€ в месяц");

      const monthlyNode = env.dom.window.document.createElement("div");
      monthlyNode.textContent = "1386 BYN в месяц";
      env.dom.window.document.body.append(monthlyNode);

      await flushTicks();
      expect(monthlyNode.textContent).toContain("€ в месяц");

      const originalCardCommercialMonthly =
        cardCommercialMonthly.dataset.avCurrenciesOriginalText;
      const originalFinanceItemMonthly =
        financeItemMonthly.dataset.avCurrenciesOriginalText;
      const originalFinanceRange =
        financeRange.dataset.avCurrenciesOriginalText;

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(cardCommercialMonthly.textContent).toBe(
        originalCardCommercialMonthly,
      );
      expect(financeItemMonthly.textContent).toBe(originalFinanceItemMonthly);
      expect(financeRange.textContent).toBe(originalFinanceRange);
      expect(financeDate.textContent).toBe("13 — 84 мес.");
      expect(sideFinanceMonthly.textContent).toBe("1386 BYN в месяц");
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

      const dynamicPartsPrice = env.dom.window.document.createElement("div");
      dynamicPartsPrice.className = "listing-item__price-primary";
      dynamicPartsPrice.textContent = "360 р.";
      env.dom.window.document.body.append(dynamicPartsPrice);

      await flushTicks();

      expect(dynamicPartsPrice.textContent).toContain("$");
      expect(dynamicPartsPrice.dataset.avCurrenciesOriginalText).toBe("360 р.");

      const dynamicNewCarListPrice =
        env.dom.window.document.createElement("div");
      dynamicNewCarListPrice.className = "salon-listing-items__item-price-byn";
      dynamicNewCarListPrice.textContent = "81 458 p.";
      env.dom.window.document.body.append(dynamicNewCarListPrice);

      await flushTicks();

      expect(dynamicNewCarListPrice.textContent).toContain("$");
      expect(dynamicNewCarListPrice.dataset.avCurrenciesOriginalText).toBe(
        "81 458 p.",
      );

      const dynamicNewCarDetailPrice =
        env.dom.window.document.createElement("div");
      dynamicNewCarDetailPrice.className = "salon-card__price-primary";
      dynamicNewCarDetailPrice.textContent = "92 732 p.";
      env.dom.window.document.body.append(dynamicNewCarDetailPrice);

      await flushTicks();

      expect(dynamicNewCarDetailPrice.textContent).toContain("$");
      expect(dynamicNewCarDetailPrice.dataset.avCurrenciesOriginalText).toBe(
        "92 732 p.",
      );

      const dynamicCommercial = env.dom.window.document.createElement("span");
      dynamicCommercial.className = "card__commercial-text";

      const dynamicCommercialTitle =
        env.dom.window.document.createElement("span");
      dynamicCommercialTitle.textContent = "В лизинг";

      const dynamicCommercialMonthly =
        env.dom.window.document.createElement("span");
      dynamicCommercialMonthly.textContent = "1386 BYN в месяц";

      dynamicCommercial.append(
        dynamicCommercialTitle,
        dynamicCommercialMonthly,
      );
      env.dom.window.document.body.append(dynamicCommercial);

      await flushTicks();

      expect(dynamicCommercialMonthly.textContent).toContain("$");
      expect(dynamicCommercialMonthly.textContent).toContain("в месяц");
      expect(dynamicCommercialMonthly.dataset.avCurrenciesOriginalText).toBe(
        "1386 BYN в месяц",
      );

      const dynamicFinanceRange = env.dom.window.document.createElement("div");
      dynamicFinanceRange.className = "finance-item__sum";
      dynamicFinanceRange.textContent = "9 600 — 813 333 BYN";
      env.dom.window.document.body.append(dynamicFinanceRange);

      await flushTicks();

      expect(dynamicFinanceRange.textContent).toContain("$");
      expect(dynamicFinanceRange.textContent).toContain("—");
      expect(dynamicFinanceRange.textContent).not.toContain("BYN");
      expect(dynamicFinanceRange.dataset.avCurrenciesOriginalText).toBe(
        "9 600 — 813 333 BYN",
      );

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(dynamicCommercialMonthly.textContent).toBe("1386 BYN в месяц");
      expect(dynamicFinanceRange.textContent).toBe("9 600 — 813 333 BYN");
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
