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

// GM mocks installed by earlier createPage calls in the same test must not be
// "restored" by later ones — chained restores would leak the previous mock.
const gmInstalledValues = new WeakSet();

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
  // Pages created with pretendToBeVisual: false expose no requestAnimationFrame,
  // which drives the userscript's setTimeout scheduling fallback.
  if (typeof dom.window.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame = (cb) =>
      dom.window.requestAnimationFrame(cb);
  }
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.fetch = dom.window.fetch;
  return () => Object.assign(globalThis, saved);
}

async function createPage({
  html = DEFAULT_PAGE_HTML,
  ratesCache,
  rawRatesCache,
  selectedCurrency,
  fetchImpl = rejectFetch(),
  gmGlobals,
  visual = true,
} = {}) {
  const dom = new JSDOM(html, {
    url: "https://cars.av.by/r/honda/civic/123456789",
    pretendToBeVisual: visual,
  });

  if (ratesCache !== undefined) {
    dom.window.localStorage.setItem(LS_RATES_KEY, JSON.stringify(ratesCache));
  }
  if (rawRatesCache !== undefined) {
    dom.window.localStorage.setItem(LS_RATES_KEY, rawRatesCache);
  }
  if (selectedCurrency !== undefined) {
    dom.window.localStorage.setItem(LS_CURRENCY_KEY, selectedCurrency);
  }
  dom.window.fetch = fetchImpl;

  // Unwind any page a previous createPage call in this test installed, so
  // restorePageGlobals at afterEach always unwinds to the pre-test globals
  // (multi-page tests would otherwise leak the previous page's rAF wrapper).
  restorePageGlobals();
  restorePageGlobals = installPageGlobals(dom);
  if (gmGlobals) {
    const savedGlobals = {};
    for (const key of Object.keys(gmGlobals)) {
      const previous = globalThis[key];
      savedGlobals[key] =
        previous === undefined || gmInstalledValues.has(previous)
          ? undefined
          : previous;
      globalThis[key] = gmGlobals[key];
      gmInstalledValues.add(gmGlobals[key]);
    }
    const restorePage = restorePageGlobals;
    restorePageGlobals = () => {
      restorePage();
      for (const [key, value] of Object.entries(savedGlobals)) {
        if (value === undefined) {
          delete globalThis[key];
        } else {
          globalThis[key] = value;
        }
      }
    };
  }
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

// Settles the userscript's setTimeout(applyAll, 0) fallback on pages that
// expose no requestAnimationFrame (pretendToBeVisual: false).
async function flushMacrotasks(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// GM.xmlHttpRequest / GM_xmlhttpRequest transport mock. Responses are
// delivered on a microtask so the userscript sees a deterministic order.
function gmResponder({ status = 200, body = "", networkError, timeout } = {}) {
  return {
    xmlHttpRequest(opts) {
      if (networkError) {
        queueMicrotask(() => opts.onerror());
        return {};
      }
      if (timeout) {
        queueMicrotask(() => opts.ontimeout());
        return {};
      }
      queueMicrotask(() => opts.onload({ status, responseText: body }));
      return {};
    },
  };
}

function clickCurrency(dom, code) {
  const button = [
    ...dom.window.document.querySelectorAll(".avc-currency-btn"),
  ].find((btn) => btn.textContent === code);
  expect(button, `currency button ${code} should exist`).toBeTruthy();
  button.click();
}

const STALE_FETCHED_AT = () => Date.now() - RATES_TTL_MS - 1000;

const MONTHLY_HTML = `<!DOCTYPE html><html><body>
<p>300 BYN в месяц</p>
</body></html>`;

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
      // JSON "false" — not an object
      false,
      // missing the rates object entirely
      { base: "BYN", source: "NBRB", fetchedAt: Date.now() },
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

describe("ios userscript: finance, history, and graph prices", () => {
  it("converts finance-item__sum ranges to a formatted price range", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="finance-item__sum">9\u00A0600 — 813\u00A0333 BYN</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".finance-item__sum")).toBe(
      `${formatAmount((9600 * 1) / USD_RATE)} — ${formatAmount((813333 * 1) / USD_RATE)} $`,
    );
  });

  it("converts the inline range inside finance-item__description, keeping the rest", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="finance-item__description">9\u00A0600 — 813\u00A0333 BYN, 13 — 84 мес., без поручителей</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".finance-item__description")).toBe(
      `${formatAmount((9600 * 1) / USD_RATE)} — ${formatAmount((813333 * 1) / USD_RATE)} $, 13 — 84 мес., без поручителей`,
    );
  });

  it("converts a single-amount price-history desc", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="price-history__desc">53\u00A0634\u00A0р.</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".price-history__desc")).toBe(
      `${formatAmount((53634 * 1) / USD_RATE)} $`,
    );
  });

  it("converts a dual price-history desc while USD is selected", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="price-history__desc">53\u00A0384\u00A0р. <small>≈\u00A018\u00A0911\u00A0$</small></div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".price-history__desc")).toBe(
      `${formatAmount((53384 * 1) / USD_RATE)} $ ≈ ${formatAmount(18911)} $`,
    );
  });

  it("converts a dual price-history desc through USD when EUR is selected", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="price-history__desc">53\u00A0384\u00A0р. <small>≈\u00A018\u00A0911\u00A0$</small></div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "EUR",
    });
    await settle(dom);

    expect(text(dom, ".price-history__desc")).toBe(
      `${formatAmount((53384 * 1) / EUR_RATE)} € ≈ ${formatAmount((18911 * USD_RATE) / EUR_RATE)} €`,
    );
  });

  it("converts the USD approximation in stats__price-secondary to EUR", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="stats__price-secondary">≈\u00A018\u00A0911\u00A0$</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "EUR",
    });
    await settle(dom);

    expect(text(dom, ".stats__price-secondary")).toBe(
      `≈ ${formatAmount((18911 * USD_RATE) / EUR_RATE)} €`,
    );
  });

  it("converts graph item and graph log sum prices", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="graph-item__price">5\u00A0300\u00A0р.</div>
<div class="graph-log__sum">53\u00A0900</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".graph-item__price")).toBe(
      `${formatAmount((5300 * 1) / USD_RATE)} $`,
    );
    expect(text(dom, ".graph-log__sum")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
  });

  it("converts graph log diffs while keeping the sign prefix", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="graph-log__diff">−\u00A0300\u00A0р.</div>
<div class="graph-log__diff">+\u00A01\u00A0200\u00A0р.</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    const diffs = [
      ...dom.window.document.querySelectorAll(".graph-log__diff"),
    ].map((el) => el.textContent);
    expect(diffs).toEqual([
      `−\u00A0${formatAmount((300 * 1) / USD_RATE)} $`,
      `+\u00A0${formatAmount((1200 * 1) / USD_RATE)} $`,
    ]);
  });

  it("leaves price elements without any digits untouched", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="listing-item__price-primary">Цена по запросу</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".listing-item__price-primary")).toBe("Цена по запросу");
  });

  it("ignores an empty salon price wrapper", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<div class="salon-listing-top__prices"></div>
<div class="listing-item__price-primary">53\u00A0900 р.</div>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
  });
});

describe("ios userscript: dynamic monthly nodes", () => {
  it("restores the original monthly text when switching back to BYN", async () => {
    const dom = await createPage({
      html: MONTHLY_HTML,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, "p")).toBe(`${formatAmount(300 / USD_RATE)} $ в месяц`);

    clickCurrency(dom, "BYN");
    await settle(dom);
    expect(text(dom, "p")).toBe("300 BYN в месяц");
  });

  it("keeps monthly-marker text without an amount unchanged", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<p>BYN в месяц</p>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, "p")).toBe("BYN в месяц");

    // An SPA rewrite of that node is still restored to the original text.
    dom.window.document.querySelector("p").firstChild.data = "изменилось";
    await settle(dom);
    expect(text(dom, "p")).toBe("BYN в месяц");
  });

  it("ignores text mutations outside any watched selector", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<p>обычный текст</p>
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    dom.window.document.querySelector("p").firstChild.data = "другой текст";
    await settle(dom);

    expect(text(dom, "p")).toBe("другой текст");
  });

  it("converts a dynamically appended monthly text node", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body><div id="host"></div></body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    const host = dom.window.document.querySelector("#host");
    host.appendChild(dom.window.document.createTextNode("700 BYN в месяц"));
    await settle(dom);

    expect(host.textContent).toBe(`${formatAmount(700 / USD_RATE)} $ в месяц`);
  });

  it("ignores comment nodes and monthly text inside style elements", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body></body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    const style = dom.window.document.createElement("style");
    style.textContent = "999 BYN в месяц";
    dom.window.document.body.appendChild(style);
    dom.window.document.body.appendChild(
      dom.window.document.createComment("500 BYN в месяц"),
    );
    await settle(dom);

    expect(style.textContent).toBe("999 BYN в месяц");
  });

  it("re-applies the converted price after an SPA text mutation", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    const el = dom.window.document.querySelector(
      ".listing-item__price-primary",
    );
    el.firstChild.data = "60\u00A0000 р.";
    await settle(dom);

    expect(el.textContent).toBe(`${formatAmount((53900 * 1) / USD_RATE)} $`);
  });

  it("re-processes a tracked monthly node after its text mutates", async () => {
    const dom = await createPage({
      html: MONTHLY_HTML,
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
    });
    await settle(dom);

    const p = dom.window.document.querySelector("p");
    p.firstChild.data = "900 BYN в месяц";
    await settle(dom);

    // The original amount is preserved in the WeakMap, so the converted
    // value is rebuilt from "300 BYN в месяц", not from the mutated text.
    expect(p.textContent).toBe(`${formatAmount(300 / USD_RATE)} $ в месяц`);
  });
});

describe("ios userscript: original days on sale", () => {
  const STAT_HTML = `<div class="card__stat-item">Опубликовано 12.05.2025</div>`;

  it("appends the days-on-sale suffix to the matching stat item", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"initialState":{"advert":{"advert":{"originalDaysOnSale":5}}}}}</script>
${STAT_HTML}
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "BYN",
    });
    await settle(dom);

    expect(text(dom, ".card__stat-item")).toBe(
      "Опубликовано 12.05.2025, всего 5 дней в продаже",
    );
  });

  it("skips the suffix when originalDaysOnSale is absent", async () => {
    const dom = await createPage({
      html: `<!DOCTYPE html><html><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"initialState":{"advert":{"advert":{}}}}}</script>
${STAT_HTML}
</body></html>`,
      ratesCache: buildCachedRates(),
      selectedCurrency: "BYN",
    });
    await settle(dom);

    expect(text(dom, ".card__stat-item")).toBe("Опубликовано 12.05.2025");
  });

  it("logs and survives an invalid __NEXT_DATA__ payload", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const dom = await createPage({
        html: `<!DOCTYPE html><html><body>
<script id="__NEXT_DATA__" type="application/json">not-json{</script>
${STAT_HTML}
</body></html>`,
        ratesCache: buildCachedRates(),
        selectedCurrency: "BYN",
      });
      await settle(dom);

      expect(text(dom, ".card__stat-item")).toBe("Опубликовано 12.05.2025");
      expect(errorSpy).toHaveBeenCalledWith(
        "Error displaying originalDaysOnSale:",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("ios userscript: network transports", () => {
  it("fetches rates through GM.xmlHttpRequest without touching window.fetch", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
      selectedCurrency: "USD",
      fetchImpl: rejectFetch(),
      gmGlobals: {
        GM: gmResponder({ body: JSON.stringify(nbrbFixture) }),
      },
    });
    await settle(dom);

    expect(dom.window.fetch).not.toHaveBeenCalled();
    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * fixtureRates.USD.scale) / fixtureRates.USD.rate)} $`,
    );
  });

  it("falls back to the legacy GM_xmlhttpRequest global", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
      selectedCurrency: "USD",
      fetchImpl: rejectFetch(),
      gmGlobals: {
        GM_xmlhttpRequest: gmResponder({
          body: JSON.stringify(nbrbFixture),
        }).xmlHttpRequest,
      },
    });
    await settle(dom);

    expect(dom.window.fetch).not.toHaveBeenCalled();
    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * fixtureRates.USD.scale) / fixtureRates.USD.rate)} $`,
    );
  });

  it("reports GM transport failures in the widget error line", async () => {
    const cases = [
      {
        gm: gmResponder({ status: 503, body: "" }),
        message: /HTTP 503/,
      },
      {
        gm: gmResponder({ body: "{oops" }),
        message: /Ошибка обновления/,
      },
      {
        gm: gmResponder({ networkError: true }),
        message: /network error/,
      },
      { gm: gmResponder({ timeout: true }), message: /timeout/ },
    ];

    for (const { gm, message } of cases) {
      const dom = await createPage({
        ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
        selectedCurrency: "USD",
        fetchImpl: rejectFetch(),
        gmGlobals: { GM: gm },
      });
      await settle(dom);

      expect(text(dom, ".avc-err")).toMatch(message);
    }
  });

  it("reports an HTTP error for a non-ok fetch response", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
      selectedCurrency: "USD",
      fetchImpl: vi.fn(() =>
        Promise.resolve({ ok: false, status: 500, json: async () => [] }),
      ),
    });
    await settle(dom);

    expect(text(dom, ".avc-err")).toMatch(/HTTP 500/);
    // Prices keep converting from the last valid cached rates.
    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
  });

  it("rejects a fetched payload that is missing RUB and lacks a date", async () => {
    // Drop RUB entirely and strip Date from the first item so the
    // ratesDate fallback (`: null`) is exercised as well.
    const payload = nbrbFixture
      .filter((item) => item.Cur_Abbreviation !== "RUB")
      .map((item, index) =>
        index === 0 ? { ...item, Date: undefined } : item,
      );
    const dom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
      selectedCurrency: "USD",
      fetchImpl: vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: async () => payload }),
      ),
    });
    await settle(dom);

    expect(text(dom, ".avc-err")).toMatch(/USD\/EUR\/RUB/);
  });

  it("rejects a non-array fetched payload", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
      selectedCurrency: "USD",
      fetchImpl: vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ not: "an array" }),
        }),
      ),
    });
    await settle(dom);

    expect(text(dom, ".avc-err")).toMatch(/Ошибка обновления/);
  });

  it("aborts the fetch with the 10s timeout and shows the error", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url, opts) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );
      const dom = await createPage({
        selectedCurrency: "USD",
        fetchImpl,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(text(dom, ".avc-err")).toMatch(/aborted/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the empty state and keeps BYN prices when nothing is cached and the fetch fails", async () => {
    const dom = await createPage({
      selectedCurrency: "USD",
      fetchImpl: rejectFetch(),
    });
    await settle(dom);

    expect(text(dom, "#avc-rates")).toBe("Курсы пока не загружены");
    expect(text(dom, "#avc-meta")).toBe("");
    expect(text(dom, ".avc-err")).toMatch(/Ошибка обновления/);
    expect(text(dom, ".listing-item__price-primary")).toBe("53\u00A0900 р.");
  });

  it("stores fetched rates in localStorage with their NBRB date", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
      selectedCurrency: "USD",
      fetchImpl: fixtureFetch(),
    });
    await settle(dom);

    const stored = JSON.parse(dom.window.localStorage.getItem(LS_RATES_KEY));
    const expectedRatesDate = new Date(nbrbFixture[0].Date)
      .toISOString()
      .slice(0, 10);

    expect(stored.source).toBe("NBRB");
    expect(stored.rates.USD.rate).toBe(fixtureRates.USD.rate);
    expect(stored.ratesDate).toBe(expectedRatesDate);
    expect(text(dom, "#avc-meta")).toMatch(/Обновлено:/);
  });
});

describe("ios userscript: widget interactions", () => {
  it("opens and closes the panel from the toggle button", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "BYN",
    });
    await settle(dom);

    const panel = dom.window.document.querySelector("#avc-panel");
    const toggle = dom.window.document.querySelector("#avc-toggle");
    expect(panel.hidden).toBe(true);

    toggle.click();
    expect(panel.hidden).toBe(false);

    toggle.click();
    expect(panel.hidden).toBe(true);
  });

  it("closes the open panel after a click outside the widget", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "BYN",
    });
    await settle(dom);

    const panel = dom.window.document.querySelector("#avc-panel");
    dom.window.document.querySelector("#avc-toggle").click();
    expect(panel.hidden).toBe(false);

    dom.window.document.body.click();
    expect(panel.hidden).toBe(true);
  });

  it("force-refreshes rates from the refresh button and restores its label", async () => {
    let releaseJson;
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((resolve) => {
            releaseJson = () => resolve(nbrbFixture);
          }),
      }),
    );
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
      fetchImpl,
    });
    await settle(dom);

    // Fresh cache: start() must not have fetched anything.
    expect(fetchImpl).not.toHaveBeenCalled();

    dom.window.document.querySelector("#avc-refresh").click();
    await settle(dom, 1);

    const btn = dom.window.document.querySelector("#avc-refresh");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Обновляем…");

    releaseJson();
    await settle(dom);

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Обновить курсы");
    const stored = JSON.parse(dom.window.localStorage.getItem(LS_RATES_KEY));
    expect(stored.rates.USD.rate).toBe(fixtureRates.USD.rate);
  });

  it("removes the widget error line once a later render succeeds", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates({ fetchedAt: STALE_FETCHED_AT() }),
      selectedCurrency: "USD",
    });
    await settle(dom);

    expect(text(dom, ".avc-err")).toMatch(/Ошибка обновления/);

    clickCurrency(dom, "EUR");
    await settle(dom);

    expect(dom.window.document.querySelector(".avc-err")).toBeNull();
  });
});

describe("ios userscript: storage and scheduling edges", () => {
  it("recovers from an unparseable rates cache via the network", async () => {
    const dom = await createPage({
      rawRatesCache: "{oops",
      selectedCurrency: "USD",
      fetchImpl: fixtureFetch(),
    });
    await settle(dom);

    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * fixtureRates.USD.scale) / fixtureRates.USD.rate)} $`,
    );
  });

  it("falls back to BYN for an unknown stored currency", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "GBP",
    });
    await settle(dom);

    expect(text(dom, "#avc-toggle-label")).toBe("BYN");
    expect(text(dom, ".listing-item__price-primary")).toBe("53\u00A0900 р.");
  });

  it("converts prices via the setTimeout fallback when rAF is unavailable", async () => {
    const dom = await createPage({
      ratesCache: buildCachedRates(),
      selectedCurrency: "USD",
      visual: false,
    });
    await flushMacrotasks();

    expect(text(dom, ".listing-item__price-primary")).toBe(
      `${formatAmount((53900 * 1) / USD_RATE)} $`,
    );
  });
});
