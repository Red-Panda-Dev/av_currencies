import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import { describe, it, expect, vi, afterEach } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nbrbFixturePath = join(__dirname, "..", "examples", "nbrb_response.json");

const nbrbFixture = JSON.parse(readFileSync(nbrbFixturePath, "utf-8"));

const fixtureRates = {};
for (const item of nbrbFixture) {
  if (["USD", "EUR", "RUB"].includes(item.Cur_Abbreviation)) {
    fixtureRates[item.Cur_Abbreviation] = {
      rate: item.Cur_OfficialRate,
      scale: item.Cur_Scale,
    };
  }
}

const LS_RATES_KEY = "avc.ratesData.v1";
const LS_CURRENCY_KEY = "avc.selectedCurrency.v1";
const RATES_TTL_MS = 4 * 60 * 60 * 1000;

const USD_RATE = 3.3;
const EUR_RATE = 3.6;
const RUB_RATE = 3.45; // per 100 RUB

function buildCachedRates({ fetchedAt = Date.now(), usd = {}, rates } = {}) {
  return {
    base: "BYN",
    source: "NBRB",
    sourceUrl: "https://api.nbrb.by/exrates/rates?periodicity=0",
    fetchedAt,
    ratesDate: "2026-10-04",
    rates: rates ?? {
      USD: {
        code: "USD",
        name: "Доллар США",
        scale: 1,
        rate: USD_RATE,
        ...usd,
      },
      EUR: { code: "EUR", name: "Евро", scale: 1, rate: EUR_RATE },
      RUB: {
        code: "RUB",
        name: "Российский рубль",
        scale: 100,
        rate: RUB_RATE,
      },
    },
  };
}

// Locale grouping only; the numeric value under test is computed explicitly.
function formatAmount(amount) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

const DEFAULT_PAGE_HTML = `<!DOCTYPE html><html><body>
<div class="listing-item__price-primary">53\u00A0900 р.</div>
</body></html>`;

function rejectFetch() {
  return vi.fn(() => Promise.reject(new Error("network disabled in test")));
}

function fixtureFetch() {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => nbrbFixture,
    }),
  );
}

let restorePageGlobals = () => {};

// The userscript is imported (not eval'd) so it goes through Vite's
// transform pipeline and v8 coverage attributes it to the file;
// vi.resetModules() clears the module cache so each test re-runs the
// IIFE against a fresh jsdom page.
function installPageGlobals(dom) {
  const saved = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    MutationObserver: globalThis.MutationObserver,
    NodeFilter: globalThis.NodeFilter,
    fetch: globalThis.fetch,
  };
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.requestAnimationFrame = (cb) =>
    dom.window.requestAnimationFrame(cb);
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.fetch = dom.window.fetch;
  return () => Object.assign(globalThis, saved);
}

async function createPage({
  html = DEFAULT_PAGE_HTML,
  ratesCache,
  selectedCurrency,
  fetchImpl = rejectFetch(),
} = {}) {
  const dom = new JSDOM(html, {
    url: "https://cars.av.by/r/honda/civic/123456789",
    pretendToBeVisual: true,
  });

  if (ratesCache !== undefined) {
    dom.window.localStorage.setItem(LS_RATES_KEY, JSON.stringify(ratesCache));
  }
  if (selectedCurrency !== undefined) {
    dom.window.localStorage.setItem(LS_CURRENCY_KEY, selectedCurrency);
  }
  dom.window.fetch = fetchImpl;

  restorePageGlobals = installPageGlobals(dom);
  await vi.resetModules();
  await import("../ios/av-currencies.user.js");
  return dom;
}

afterEach(() => {
  restorePageGlobals();
  restorePageGlobals = () => {};
});

// The userscript schedules applyAll() via requestAnimationFrame; await the
// actual frame callbacks instead of fixed sleeps.
async function settle(dom, frames = 6) {
  for (let i = 0; i < frames; i += 1) {
    await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  }
}

function text(dom, selector) {
  return dom.window.document.querySelector(selector)?.textContent ?? null;
}

function clickCurrency(dom, code) {
  const button = [
    ...dom.window.document.querySelectorAll(".avc-currency-btn"),
  ].find((btn) => btn.textContent === code);
  expect(button, `currency button ${code} should exist`).toBeTruthy();
  button.click();
}

describe("ios userscript", () => {
  it("converts plain prices to USD from a fresh cache without network", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
    expect(dom.window.fetch).not.toHaveBeenCalled();
    expect(text(dom, "#avc-toggle-label")).toBe("USD");
  });

  it("accounts for RUB scale 100 when converting to RUB", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="listing-item__price-primary">100 р.</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "RUB",
    });
    await settle(dom);

    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((100 * 100) / RUB_RATE)} RUB`,
    );
  });

  it("converts monthly element prices and monthly text nodes", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="card__commercial-text"><span>Лизинг</span><span>500 BYN в месяц</span></div>
<p>300 BYN в месяц</p>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".card__commercial-text > span:last-child")).toBe(
      `${formatAmount((500 * 1) / USD_RATE)} $ в месяц`,
    );
    expect(text(dom, "p")).toBe(
      `${formatAmount((300 * 1) / USD_RATE)} $ в месяц`,
    );
  });

  it("clears and restores the salon suffix rendered as a span", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="salon-listing-top__prices"><div>53\u00A0900</div><span>p.</span></div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".salon-listing-top__prices > div")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
    expect(text(dom, ".salon-listing-top__prices > span")).toBe("");

    clickCurrency(dom, "BYN");
    await settle(dom);
    expect(text(dom, ".salon-listing-top__prices > div")).toBe("53\u00A0900");
    expect(text(dom, ".salon-listing-top__prices > span")).toBe("p.");
  });

  it("clears and restores the salon suffix rendered as a small element", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="salon-listing-top__prices"><div>53\u00A0900</div><small> руб.</small></div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".salon-listing-top__prices > small")).toBe("");

    clickCurrency(dom, "BYN");
    await settle(dom);
    expect(text(dom, ".salon-listing-top__prices > small")).toBe(" руб.");
  });

  it("converts the fullscreen gallery price and the commercial price", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="fullscreen-gallery__price">109\u00A0000 <small>руб.</small></div>
<div class="card__commercial-price"><b>500</b></div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".fullscreen-gallery__price")).toBe(
      `${formatAmount((109000 * 1) / USD_RATE)} $`,
    );
    expect(text(dom, ".card__commercial-price b")).toBe(
      `${formatAmount((500 * 1) / USD_RATE)} $`,
    );

    clickCurrency(dom, "BYN");
    await settle(dom);
    expect(text(dom, ".fullscreen-gallery__price")).toBe("109\u00A0000 руб.");
    expect(text(dom, ".card__commercial-price b")).toBe("500");
  });

  it("switches currency from the widget and persists the selection", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "BYN",
    });
    await settle(dom);

    expect(text(dom, ".listing-item__price-primary")).toBe("53\u00A0900 р.");

    clickCurrency(dom, "USD");
    await settle(dom);
    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
    expect(dom.window.localStorage.getItem(LS_CURRENCY_KEY)).toBe("USD");

    clickCurrency(dom, "EUR");
    await settle(dom);
    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * 1) / EUR_RATE)} €`,
    );

    clickCurrency(dom, "BYN");
    await settle(dom);
    expect(text(dom, ".listing-item__price-primary")).toBe("53\u00A0900 р.");
    expect(dom.window.localStorage.getItem(LS_CURRENCY_KEY)).toBe("BYN");
  });

  it("refetches instead of using corrupt cached rates", async () => {
    const corruptCaches = [
      // missing EUR entirely
      buildCachedRates({
        rates: {
          USD: { code: "USD", name: "Доллар США", scale: 1, rate: USD_RATE },
        },
      }),
      // non-numeric USD rate
      buildCachedRates({ usd: { rate: "abc" } }),
      // zero USD scale
      buildCachedRates({ usd: { scale: 0 } }),
      // non-numeric fetchedAt
      buildCachedRates({ fetchedAt: "yesterday" }),
    ];

    for (const ratesCache of corruptCaches) {
      const fetchImpl = fixtureFetch();
      const dom = await createPage({
        ratesCache,
        selectedCurrency: "USD",
        fetchImpl,
      });
      await settle(dom);

      const priceText = text(dom, ".listing-item__price-primary");
      expect(fetchImpl).toHaveBeenCalled();
      expect(priceText).not.toMatch(/NaN|Infinity/);
      expect(priceText, "corrupt cache must be replaced by fetched rates").toBe(
        `${formatAmount((53900 * fixtureRates.USD.scale) / fixtureRates.USD.rate)} $`,
      );
    }
  });

  it("keeps previously cached rates applied when a refresh fails", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates({
        fetchedAt: Date.now() - RATES_TTL_MS - 1000,
      }),
      selectedCurrency: "USD",
      fetchImpl: rejectFetch(),
    });
    await settle(dom);

    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
    expect(text(dom, ".avc-err")).toMatch(/Ошибка обновления/);
  });

  it("skips the network while the cache is fresh and refetches when stale", async () => {
    const freshDom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: Date.now() }),
      selectedCurrency: "USD",
    });
    await settle(freshDom);
    expect(freshDom.window.fetch).not.toHaveBeenCalled();

    const staleDom = await createPage({
      ratesCache: buildCachedRates({
        fetchedAt: Date.now() - RATES_TTL_MS - 1000,
      }),
      selectedCurrency: "USD",
      fetchImpl: fixtureFetch(),
    });
    await settle(staleDom);
    expect(staleDom.window.fetch).toHaveBeenCalled();
  });
});
