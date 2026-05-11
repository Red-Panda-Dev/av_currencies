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
const autoCardMobiFixturePath = join(
  __dirname,
  "..",
  "examples",
  "auto_card_mobi.html",
);

const contentScriptSource = readFileSync(scriptPath, "utf-8");
const indexFixture = readFileSync(indexFixturePath, "utf-8");
const autoCardFixture = readFileSync(autoCardFixturePath, "utf-8");
const newCarsListFixture = readFileSync(newCarsListFixturePath, "utf-8");
const newCarPageFixture = readFileSync(newCarPageFixturePath, "utf-8");
const partsListFixture = readFileSync(partsListFixturePath, "utf-8");
const autoCardMobiFixture = readFileSync(autoCardMobiFixturePath, "utf-8");

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
      expect(financeDate.textContent).toContain("13");
      expect(financeDate.textContent).toContain("84");
      expect(financeDate.textContent).toContain("мес.");
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
      expect(financeDate.textContent).toContain("13");
      expect(financeDate.textContent).toContain("84");
      expect(financeDate.textContent).toContain("мес.");
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

  it("converts price-history desc elements in analyse modal", async () => {
    const modalHtml = `
      <html><body>
        <div class="price-history">
          <div class="price-history__box">
            <div class="price-history__wrap">
              <div class="price-history__desc">53\u00A0634\u00A0р.</div>
            </div>
            <p>цена на этот авто средняя по рынку</p>
          </div>
          <div class="price-history__box">
            <div class="price-history__wrap">
              <div class="price-history__desc">53\u00A0384\u00A0р. <small>≈\u00A018\u00A0911\u00A0$</small></div>
            </div>
            <p>средняя цена на похожие авто</p>
          </div>
        </div>
      </body></html>
    `;

    const env = await bootstrapContentScript(modalHtml, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const descs = [
        ...env.dom.window.document.querySelectorAll(".price-history__desc"),
      ];
      expect(descs.length).toBe(2);

      expect(descs[0].textContent).toContain("$");
      expect(descs[0].textContent).not.toContain("р.");
      expect(descs[0].dataset.avCurrenciesOriginalText).toContain("р.");

      expect(descs[1].textContent).toContain("≈");
      expect(descs[1].textContent).toContain("$");
      expect(descs[1].textContent).not.toContain("р.");
      expect(descs[1].dataset.avCurrenciesOriginalText).toContain("р.");

      const originalFirst = descs[0].dataset.avCurrenciesOriginalText;
      const originalSecond = descs[1].dataset.avCurrenciesOriginalText;

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(descs[0].textContent).toBe(originalFirst);
      expect(descs[1].textContent).toBe(originalSecond);
    } finally {
      env.cleanup();
    }
  });

  it("converts price-history dual element with USD to EUR correctly", async () => {
    const modalHtml = `
      <html><body>
        <div class="price-history__desc">53\u00A0384\u00A0р. <small>≈\u00A018\u00A0911\u00A0$</small></div>
      </body></html>
    `;

    const env = await bootstrapContentScript(modalHtml, {
      ratesData: sampleRates,
      selectedCurrency: "EUR",
    });

    try {
      const desc = env.dom.window.document.querySelector(
        ".price-history__desc",
      );
      expect(desc).not.toBeNull();
      expect(desc.textContent).toContain("≈");
      expect(desc.textContent).toContain("€");
      expect(desc.textContent).not.toContain("р.");
      expect(desc.textContent).not.toContain("$");
    } finally {
      env.cleanup();
    }
  });

  it("converts dynamically added price-history desc elements", async () => {
    const env = await bootstrapContentScript("<html><body></body></html>", {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const desc = env.dom.window.document.createElement("div");
      desc.className = "price-history__desc";
      desc.textContent = "53\u00A0634\u00A0р.";
      env.dom.window.document.body.append(desc);

      await flushTicks();

      expect(desc.textContent).toContain("$");
      expect(desc.textContent).not.toContain("р.");
      expect(desc.dataset.avCurrenciesOriginalText).toContain("р.");

      const dualDesc = env.dom.window.document.createElement("div");
      dualDesc.className = "price-history__desc";
      dualDesc.innerHTML =
        "53\u00A0384\u00A0р. <small>≈\u00A018\u00A0911\u00A0$</small>";
      env.dom.window.document.body.append(dualDesc);

      await flushTicks();

      expect(dualDesc.textContent).toContain("≈");
      expect(dualDesc.textContent).toContain("$");
      expect(dualDesc.textContent).not.toContain("р.");
    } finally {
      env.cleanup();
    }
  });

  it("converts card-finance description price", async () => {
    const env = await bootstrapContentScript(
      `<html><body>
        <div class="card-finance__header">
          <h2 class="card-finance__title">Кредиты и лизинг на\u00A0покупку</h2>
          <p class="card-finance__description">Peugeot 3008 II · Рестайлинг, <span>53\u00A0634\u00A0р.</span></p>
        </div>
      </body></html>`,
      { selectedCurrency: "USD", ratesData: sampleRates },
    );

    try {
      await flushTicks();

      const span = env.dom.window.document.querySelector(
        ".card-finance__description span",
      );
      expect(span.textContent).toContain("$");
      expect(span.textContent).not.toContain("р.");
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

  it("converts mobile card page finance description and carousel prices", async () => {
    const env = await bootstrapContentScript(autoCardMobiFixture, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const cardPrice = env.dom.window.document.querySelector(
        ".card__price-button",
      );
      expect(cardPrice).not.toBeNull();
      expect(cardPrice.textContent).toContain("$");

      const financeSum =
        env.dom.window.document.querySelector(".finance-item__sum");
      expect(financeSum).not.toBeNull();
      expect(financeSum.textContent).toContain("$");
      expect(financeSum.textContent).not.toContain("BYN");

      const financeSubtitle = env.dom.window.document.querySelector(
        ".finance-item__subtitle",
      );
      expect(financeSubtitle).not.toBeNull();
      expect(financeSubtitle.textContent).toContain("$");
      expect(financeSubtitle.textContent).toContain("в");
      expect(financeSubtitle.textContent).not.toContain("BYN");

      const carouselPrices = [
        ...env.dom.window.document.querySelectorAll(
          ".listing-top__price-primary",
        ),
      ];
      expect(carouselPrices.length).toBeGreaterThan(0);
      for (const price of carouselPrices) {
        expect(price.textContent).toContain("$");
        expect(price.textContent).not.toMatch(/[рp]\./i);
      }

      const featuredPrice = env.dom.window.document.querySelector(
        ".featured__price-value strong",
      );
      expect(featuredPrice).not.toBeNull();
      expect(featuredPrice.textContent).toContain("$");

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(financeSum.dataset.avCurrenciesOriginalText).toContain("BYN");
      expect(financeSubtitle.dataset.avCurrenciesOriginalText).toContain("BYN");
    } finally {
      env.cleanup();
    }
  });

  it("converts finance-item__description with inline BYN range", async () => {
    const html = `<html><body>
      <div class="finance-item__details">
        <div class="finance-item__description">9\u00A0600 — 813\u00A0333 BYN, 13 — 84 мес., c\u00A0досрочным погашением, без поручителей</div>
      </div>
    </body></html>`;

    const env = await bootstrapContentScript(html, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const desc = env.dom.window.document.querySelector(
        ".finance-item__description",
      );
      expect(desc).not.toBeNull();
      expect(desc.textContent).toContain("$");
      expect(desc.textContent).not.toContain("BYN");
      expect(desc.textContent).toContain("13 — 84 мес.");
      expect(desc.textContent).toContain("досрочным погашением");
      expect(desc.dataset.avCurrenciesOriginalText).toContain("BYN");

      const originalText = desc.dataset.avCurrenciesOriginalText;
      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(desc.textContent).toBe(originalText);
    } finally {
      env.cleanup();
    }
  });

  it("converts featured-item__price-primary prices", async () => {
    const html = `<html><body>
      <div class="featured-item__price">
        <div class="featured-item__price-primary"><span>300</span>&nbsp;р.</div>
      </div>
    </body></html>`;

    const env = await bootstrapContentScript(html, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const price = env.dom.window.document.querySelector(
        ".featured-item__price-primary",
      );
      expect(price).not.toBeNull();
      expect(price.textContent).toContain("$");
      expect(price.textContent).not.toContain("р.");
      expect(price.dataset.avCurrenciesOriginalText).toContain("р.");

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(price.textContent).toBe(price.dataset.avCurrenciesOriginalText);
    } finally {
      env.cleanup();
    }
  });

  it("displays originalDaysOnSale in card stats", async () => {
    const html = `<html><body>
      <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "initialState": {
              "advert": {
                "advert": {
                  "originalDaysOnSale": 10
                }
              }
            }
          }
        }
      </script>
      <ul>
        <li class="card__stat-item">опубликовано 16 апреля</li>
        <li class="card__stat-item">поднято 4 часа назад</li>
      </ul>
    </body></html>`;

    const env = await bootstrapContentScript(html, {
      ratesData: sampleRates,
      selectedCurrency: "BYN",
    });

    try {
      await flushTicks();

      const statItem =
        env.dom.window.document.querySelector(".card__stat-item");
      expect(statItem).not.toBeNull();
      expect(statItem.textContent).toContain("опубликовано 16 апреля");
      expect(statItem.textContent).toContain("всего 10 дней в продаже");
    } finally {
      env.cleanup();
    }
  });

  it("displays originalDaysOnSale in mobile card date-item", async () => {
    const html = `<html><body>
      <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "initialState": {
              "advert": {
                "advert": {
                  "originalDaysOnSale": 2
                }
              }
            }
          }
        }
      </script>
      <div class="card__meta">
        <ul class="card__stat">
          <li class="card__stat-item"><button>1827</button></li>
        </ul>
        <div class="card__date">
          <div class="card__date-item">опубликовано 15 часов назад</div>
        </div>
      </div>
    </body></html>`;

    const env = await bootstrapContentScript(html, {
      ratesData: sampleRates,
      selectedCurrency: "BYN",
    });

    try {
      await flushTicks();

      const dateItem =
        env.dom.window.document.querySelector(".card__date-item");
      expect(dateItem).not.toBeNull();
      expect(dateItem.textContent).toContain("опубликовано 15 часов назад");
      expect(dateItem.textContent).toContain("всего 2 дней в продаже");
    } finally {
      env.cleanup();
    }
  });

  it("converts graph-item prices, graph-log diff, and graph-log sum in long modal", async () => {
    const html = `<html><body>
      <div class="graph">
        <div class="graph__items">
          <div class="graph-item">
            <div class="graph-item__price">39\u00A0879\u00A0р.</div>
          </div>
          <div class="graph-item">
            <div class="graph-item__price">37\u00A0487\u00A0р.</div>
          </div>
        </div>
        <div class="graph__logs">
          <div class="graph-log">
            <div class="graph-log__diff">\u2212 2\u00A0392\u00A0р.</div>
            <div class="graph-log__sum">37\u00A0487\u00A0р.</div>
          </div>
          <div class="graph-log">
            <div class="graph-log__diff">Начальная цена</div>
            <div class="graph-log__sum">39\u00A0879\u00A0р.</div>
          </div>
        </div>
      </div>
    </body></html>`;

    const env = await bootstrapContentScript(html, {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const itemPrices = [
        ...env.dom.window.document.querySelectorAll(".graph-item__price"),
      ];
      expect(itemPrices.length).toBe(2);
      for (const el of itemPrices) {
        expect(el.textContent).toContain("$");
        expect(el.textContent).not.toContain("р.");
        expect(el.dataset.avCurrenciesOriginalText).toContain("р.");
      }

      const logSums = [
        ...env.dom.window.document.querySelectorAll(".graph-log__sum"),
      ];
      expect(logSums.length).toBe(2);
      for (const el of logSums) {
        expect(el.textContent).toContain("$");
        expect(el.textContent).not.toContain("р.");
      }

      const logDiffs = [
        ...env.dom.window.document.querySelectorAll(".graph-log__diff"),
      ];
      expect(logDiffs.length).toBe(2);
      // Numeric diff: converted and prefixed
      expect(logDiffs[0].textContent).toContain("$");
      expect(logDiffs[0].textContent).not.toContain("р.");
      // Text-only diff: unchanged
      expect(logDiffs[1].textContent).toBe("Начальная цена");

      // Restore to BYN
      const originalItemTexts = itemPrices.map(
        (el) => el.dataset.avCurrenciesOriginalText,
      );
      const originalSumTexts = logSums.map(
        (el) => el.dataset.avCurrenciesOriginalText,
      );
      const originalDiffText = logDiffs[0].dataset.avCurrenciesOriginalText;

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      for (const [i, el] of itemPrices.entries()) {
        expect(el.textContent).toBe(originalItemTexts[i]);
      }
      for (const [i, el] of logSums.entries()) {
        expect(el.textContent).toBe(originalSumTexts[i]);
      }
      expect(logDiffs[0].textContent).toBe(originalDiffText);
      expect(logDiffs[1].textContent).toBe("Начальная цена");
    } finally {
      env.cleanup();
    }
  });

  it("converts dynamically added graph-log elements", async () => {
    const env = await bootstrapContentScript("<html><body></body></html>", {
      ratesData: sampleRates,
      selectedCurrency: "USD",
    });

    try {
      const graphLog = env.dom.window.document.createElement("div");
      graphLog.className = "graph-log";

      const diff = env.dom.window.document.createElement("div");
      diff.className = "graph-log__diff";
      diff.textContent = "\u2212 1\u00A0000\u00A0р.";

      const sum = env.dom.window.document.createElement("div");
      sum.className = "graph-log__sum";
      sum.textContent = "38\u00A0000\u00A0р.";

      graphLog.append(diff, sum);
      env.dom.window.document.body.append(graphLog);

      await flushTicks();

      expect(diff.textContent).toContain("$");
      expect(diff.textContent).not.toContain("р.");
      expect(sum.textContent).toContain("$");
      expect(sum.textContent).not.toContain("р.");

      await env.browserMock.browser.storage.local.set({
        selectedCurrency: "BYN",
      });
      await flushTicks();

      expect(diff.textContent).toBe(diff.dataset.avCurrenciesOriginalText);
      expect(sum.textContent).toBe(sum.dataset.avCurrenciesOriginalText);
    } finally {
      env.cleanup();
    }
  });
});
