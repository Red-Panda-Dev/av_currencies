// ==UserScript==
// @name         AV.by Валюты (Safari iOS)
// @namespace    av-by-currencies-personal
// @version      2.0.0
// @description  Замена цен на av.by из BYN в USD / EUR / RUB по курсам НБРБ.
// @match        https://av.by/*
// @match        https://*.av.by/*
// @run-at       document-end
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      api.nbrb.by
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  // ──────────────────────────────────────────────────────────────────
  // 1. Конфиг и состояние
  // ──────────────────────────────────────────────────────────────────

  const API_URL = "https://api.nbrb.by/exrates/rates?periodicity=0";
  const RATES_TTL_MS = 4 * 60 * 60 * 1000; // 4 часа
  const FETCH_TIMEOUT_MS = 10_000;

  const LS_RATES_KEY = "avc.ratesData.v1";
  const LS_CURRENCY_KEY = "avc.selectedCurrency.v1";

  const TARGET_CURRENCIES = ["USD", "EUR", "RUB"];
  const DISPLAY_CURRENCIES = ["BYN", "USD", "EUR", "RUB"];
  const DEFAULT_DISPLAY_CURRENCY = "BYN";
  const CURRENCY_SYMBOLS = { BYN: "р.", USD: "$", EUR: "€", RUB: "RUB" };
  const SCALE_LABELS = { USD: "1 USD", EUR: "1 EUR", RUB: "100 RUB" };

  let ratesData = loadRatesFromCache();
  let selectedCurrency = loadSelectedCurrency();
  let applyScheduled = false;
  let fullMonthlyScanRequested = true;

  // ──────────────────────────────────────────────────────────────────
  // 2. Селекторы / regex'ы (1:1 из оригинального content-script)
  // ──────────────────────────────────────────────────────────────────

  const PRICE_SELECTORS = [
    ".listing-index__price",
    ".listing-item__price-primary",
    ".card__price-button",
    ".listing-top__price-primary",
    ".featured__price-value strong",
    ".featured-item__price-primary",
    ".salon-listing-top__prices > div",
    ".salon-listing-model__banner-priсe",
    ".salon-listing-items__item-price-byn",
    ".salon-card__price-primary",
    ".card-finance__description span",
    ".stats__price-primary",
    ".stats-listing-item__prices",
  ];
  const MONTHLY_ELEMENT_SELECTORS = [
    ".card__commercial-text > span:last-child",
    ".finance-item__subtitle",
  ];
  const FINANCE_RANGE_SELECTORS = [".finance-item__sum"];
  const FINANCE_DESCRIPTION_SELECTORS = [".finance-item__description"];
  const PRICE_HISTORY_DESC_SELECTORS = [".price-history__desc"];
  const STATS_SECONDARY_SELECTORS = [".stats__price-secondary"];
  const GRAPH_ITEM_PRICE_SELECTORS = [".graph-item__price"];
  const GRAPH_LOG_DIFF_SELECTORS = [".graph-log__diff"];
  const GRAPH_LOG_SUM_SELECTORS = [".graph-log__sum"];
  const SALON_PRICE_WRAPPER_SELECTOR = ".salon-listing-top__prices";
  const SALON_SUFFIX_SELECTOR = "span:last-child";

  const MONTHLY_REGEX = /(\d[\d\s  ]*(?:[.,]\d+)?)\s*BYN(\s*в\s*месяц)/i;
  const MONTHLY_MARKER_REGEX = /BYN\s*в\s*месяц/i;
  const FINANCE_RANGE_REGEX =
    /(\d[\d\s  ]*(?:[.,]\d+)?)\s*[—-]\s*(\d[\d\s  ]*(?:[.,]\d+)?)\s*BYN/i;
  const FINANCE_DESCRIPTION_RANGE_REGEX = FINANCE_RANGE_REGEX;
  const PRICE_HISTORY_DUAL_REGEX =
    /^(\d[\d\s  ]*(?:[.,]\d+)?)\s*р\.\s*≈\s*(\d[\d\s  ]*(?:[.,]\d+)?)\s*\$/;
  const STATS_SECONDARY_REGEX = /^≈\s*(\d[\d\s  ]*(?:[.,]\d+)?)\s*\$/;
  const GRAPH_LOG_DIFF_REGEX = /^([−\-+]\s*)(\d[\d\s  ]*(?:[.,]\d+)?)\s*р\./;

  const SKIP_TEXT_NODE_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "TITLE",
  ]);
  const NODE_TYPE_ELEMENT = 1;
  const NODE_TYPE_TEXT = 3;
  const NODE_TYPE_DOCUMENT_FRAGMENT = 11;

  const ATTR_ORIGINAL_TEXT = "avCurrenciesOriginalText";
  const ATTR_BYN_AMOUNT = "avCurrenciesBynAmount";

  const monthlyOriginalText = new WeakMap();
  const monthlyBynAmount = new WeakMap();
  const trackedMonthlyNodes = new Set();
  const pendingMonthlyNodes = new Set();

  // ──────────────────────────────────────────────────────────────────
  // 3. Pure helpers (бывший lib/rates.js)
  // ──────────────────────────────────────────────────────────────────

  function parseRates(data) {
    if (!Array.isArray(data)) return null;
    const rates = {};
    for (const item of data) {
      if (TARGET_CURRENCIES.includes(item.Cur_Abbreviation)) {
        rates[item.Cur_Abbreviation] = {
          code: item.Cur_Abbreviation,
          name: item.Cur_Name,
          scale: item.Cur_Scale,
          rate: item.Cur_OfficialRate,
        };
      }
    }
    for (const c of TARGET_CURRENCIES) if (!rates[c]) return null;
    return rates;
  }

  function parseBynPrice(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\d[\d\s  ]*(?:[.,]\d+)?/);
    if (!match) return null;
    const normalized = match[0].replace(/[\s  ]/g, "").replace(",", ".");
    const amount = Number.parseFloat(normalized);
    return Number.isFinite(amount) ? amount : null;
  }

  function convertFromBYN(amount, rateInfo) {
    return (amount * rateInfo.scale) / rateInfo.rate;
  }

  function convertToBYN(amount, rateInfo) {
    return (amount * rateInfo.rate) / rateInfo.scale;
  }

  function formatDisplayPrice(amount, currencyCode) {
    const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode;
    const formatted = new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0,
    }).format(Math.round(amount));
    return `${formatted} ${symbol}`;
  }

  function formatDisplayPriceRange(start, end, currencyCode) {
    const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode;
    const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
    return `${fmt.format(Math.round(start))} — ${fmt.format(Math.round(end))} ${symbol}`;
  }

  function normalizeCurrency(value) {
    return DISPLAY_CURRENCIES.includes(value)
      ? value
      : DEFAULT_DISPLAY_CURRENCY;
  }

  function getRateInfo(code) {
    return ratesData?.rates?.[code] || null;
  }

  function shouldConvertPrices() {
    if (selectedCurrency === DEFAULT_DISPLAY_CURRENCY) return false;
    return Boolean(getRateInfo(selectedCurrency));
  }

  // ──────────────────────────────────────────────────────────────────
  // 4. Storage (localStorage вместо browser.storage.local)
  // ──────────────────────────────────────────────────────────────────

  function loadRatesFromCache() {
    try {
      const raw = localStorage.getItem(LS_RATES_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveRatesToCache(data) {
    try {
      localStorage.setItem(LS_RATES_KEY, JSON.stringify(data));
    } catch {}
  }

  function loadSelectedCurrency() {
    try {
      return normalizeCurrency(localStorage.getItem(LS_CURRENCY_KEY));
    } catch {
      return DEFAULT_DISPLAY_CURRENCY;
    }
  }

  function saveSelectedCurrency(c) {
    try {
      localStorage.setItem(LS_CURRENCY_KEY, c);
    } catch {}
  }

  // ──────────────────────────────────────────────────────────────────
  // 5. Сеть: тянем курсы НБРБ. fetch / GM_xmlhttpRequest fallback
  // ──────────────────────────────────────────────────────────────────

  let fetchInFlight = null;

  async function fetchRates({ force = false } = {}) {
    if (fetchInFlight && !force) return fetchInFlight;

    const now = Date.now();
    if (
      !force &&
      ratesData?.fetchedAt &&
      now - ratesData.fetchedAt < RATES_TTL_MS
    ) {
      return { success: true, rates: ratesData.rates, cached: true };
    }

    fetchInFlight = (async () => {
      try {
        const data = await httpJson(API_URL, FETCH_TIMEOUT_MS);
        const rates = parseRates(data);
        if (!rates) throw new Error("invalid response: missing USD/EUR/RUB");

        const ratesDate = data[0]?.Date
          ? new Date(data[0].Date).toISOString().slice(0, 10)
          : null;

        const next = {
          base: "BYN",
          source: "NBRB",
          sourceUrl: API_URL,
          fetchedAt: Date.now(),
          ratesDate,
          rates,
        };
        ratesData = next;
        saveRatesToCache(next);
        renderWidget();
        scheduleApply();
        return { success: true, rates };
      } catch (err) {
        renderWidget(err);
        return { success: false, error: err };
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  }

  function httpJson(url, timeoutMs) {
    const useGm =
      typeof GM !== "undefined" &&
      GM &&
      typeof GM.xmlHttpRequest === "function";
    const useGmLegacy = typeof GM_xmlhttpRequest === "function";

    if (useGm || useGmLegacy) {
      return new Promise((resolve, reject) => {
        const req = (useGm ? GM.xmlHttpRequest : GM_xmlhttpRequest)({
          method: "GET",
          url,
          timeout: timeoutMs,
          onload: (resp) => {
            if (resp.status >= 200 && resp.status < 300) {
              try {
                resolve(JSON.parse(resp.responseText));
              } catch (e) {
                reject(e);
              }
            } else {
              reject(new Error(`HTTP ${resp.status}`));
            }
          },
          onerror: () => reject(new Error("network error")),
          ontimeout: () => reject(new Error("timeout")),
        });
        return req;
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .finally(() => clearTimeout(timer));
  }

  // ──────────────────────────────────────────────────────────────────
  // 6. DOM-замена цен — 1:1 из src/content/avby.js
  // ──────────────────────────────────────────────────────────────────

  function collectElementsBySelectors(selectors) {
    const set = new Set();
    for (const s of selectors) {
      for (const el of document.querySelectorAll(s)) set.add(el);
    }
    return [...set];
  }

  function getOriginalElementText(el) {
    if (!el.dataset[ATTR_ORIGINAL_TEXT]) {
      el.dataset[ATTR_ORIGINAL_TEXT] = el.textContent || "";
    }
    return el.dataset[ATTR_ORIGINAL_TEXT];
  }

  function getElementBynAmount(el, originalText) {
    if (el.dataset[ATTR_BYN_AMOUNT]) {
      const cached = Number.parseFloat(el.dataset[ATTR_BYN_AMOUNT]);
      if (Number.isFinite(cached)) return cached;
    }
    const parsed = parseBynPrice(originalText);
    if (parsed !== null) el.dataset[ATTR_BYN_AMOUNT] = String(parsed);
    return parsed;
  }

  function applyElementPrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const amount = getElementBynAmount(el, original);
        if (amount !== null) {
          const converted = convertFromBYN(amount, rateInfo);
          const formatted = formatDisplayPrice(converted, selectedCurrency);
          next = /^\s*от\s+/i.test(original) ? `от ${formatted}` : formatted;
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function applyMonthlyElementPrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const m = original.match(MONTHLY_REGEX);
        if (m) {
          const amount = getElementBynAmount(el, original);
          if (amount !== null) {
            const replacement = `${formatDisplayPrice(
              convertFromBYN(amount, rateInfo),
              selectedCurrency,
            )}${m[2]}`;
            next = original.replace(MONTHLY_REGEX, replacement);
          }
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function applyFinanceRangePrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const m = original.match(FINANCE_RANGE_REGEX);
        if (m) {
          const s = parseBynPrice(m[1]);
          const e = parseBynPrice(m[2]);
          if (s !== null && e !== null) {
            next = formatDisplayPriceRange(
              convertFromBYN(s, rateInfo),
              convertFromBYN(e, rateInfo),
              selectedCurrency,
            );
          }
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function applyFinanceDescriptionPrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const m = original.match(FINANCE_DESCRIPTION_RANGE_REGEX);
        if (m) {
          const s = parseBynPrice(m[1]);
          const e = parseBynPrice(m[2]);
          if (s !== null && e !== null) {
            const replacement = formatDisplayPriceRange(
              convertFromBYN(s, rateInfo),
              convertFromBYN(e, rateInfo),
              selectedCurrency,
            );
            next = original.replace(
              FINANCE_DESCRIPTION_RANGE_REGEX,
              replacement,
            );
          }
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function applyPriceHistoryDescPrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const dual = original.match(PRICE_HISTORY_DUAL_REGEX);
        if (dual) {
          const byn = parseBynPrice(dual[1]);
          const usd = parseBynPrice(dual[2]);
          if (byn !== null && usd !== null) {
            const convertedByn = convertFromBYN(byn, rateInfo);
            const usdRateInfo = getRateInfo("USD");
            let convertedUsdDisplay;
            if (selectedCurrency === "USD") {
              convertedUsdDisplay = usd;
            } else if (usdRateInfo) {
              const usdInByn = convertToBYN(usd, usdRateInfo);
              convertedUsdDisplay = convertFromBYN(usdInByn, rateInfo);
            } else {
              convertedUsdDisplay = usd;
            }
            next = `${formatDisplayPrice(convertedByn, selectedCurrency)} ≈ ${formatDisplayPrice(convertedUsdDisplay, selectedCurrency)}`;
          }
        } else {
          const amount = getElementBynAmount(el, original);
          if (amount !== null) {
            next = formatDisplayPrice(
              convertFromBYN(amount, rateInfo),
              selectedCurrency,
            );
          }
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function applyStatsSecondaryPrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const m = original.match(STATS_SECONDARY_REGEX);
        if (m) {
          const usd = parseBynPrice(m[1]);
          if (usd !== null) {
            const usdRateInfo = getRateInfo("USD");
            let converted;
            if (selectedCurrency === "USD") {
              converted = usd;
            } else if (usdRateInfo) {
              const usdInByn = convertToBYN(usd, usdRateInfo);
              converted = convertFromBYN(usdInByn, rateInfo);
            } else {
              converted = usd;
            }
            next = `≈ ${formatDisplayPrice(converted, selectedCurrency)}`;
          }
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function applyGraphSumOrItemPrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const amount = getElementBynAmount(el, original);
        if (amount !== null) {
          next = formatDisplayPrice(
            convertFromBYN(amount, rateInfo),
            selectedCurrency,
          );
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function applyGraphLogDiffPrices(els) {
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;
    for (const el of els) {
      const original = getOriginalElementText(el);
      let next = original;
      if (canConvert && rateInfo) {
        const m = original.match(GRAPH_LOG_DIFF_REGEX);
        if (m) {
          const prefix = m[1];
          const amount = parseBynPrice(m[2]);
          if (amount !== null) {
            next = `${prefix}${formatDisplayPrice(
              convertFromBYN(amount, rateInfo),
              selectedCurrency,
            )}`;
          }
        }
      }
      if (el.textContent !== next) el.textContent = next;
    }
  }

  function isBynSuffixText(v) {
    if (typeof v !== "string") return false;
    const n = v.replace(/[\s  ]/g, "").toLowerCase();
    return n === "р." || n === "р" || n === "p.";
  }

  function applySalonPriceSuffixes() {
    const canConvert = shouldConvertPrices();
    for (const wrap of document.querySelectorAll(
      SALON_PRICE_WRAPPER_SELECTOR,
    )) {
      const suffix = wrap.querySelector(SALON_SUFFIX_SELECTOR);
      if (!suffix) continue;
      const original = getOriginalElementText(suffix);
      let next = original;
      if (canConvert && isBynSuffixText(original)) next = "";
      if (suffix.textContent !== next) suffix.textContent = next;
    }
  }

  // monthly text-node handling (для динамики)
  function registerMonthlyNode(node) {
    if (!node || node.nodeType !== NODE_TYPE_TEXT) return false;
    const parentTag = node.parentElement?.tagName;
    if (parentTag && SKIP_TEXT_NODE_TAGS.has(parentTag)) return false;
    if (monthlyOriginalText.has(node)) {
      trackedMonthlyNodes.add(node);
      return true;
    }
    const text = node.nodeValue;
    if (typeof text !== "string" || !MONTHLY_MARKER_REGEX.test(text))
      return false;
    monthlyOriginalText.set(node, text);
    trackedMonthlyNodes.add(node);
    return true;
  }

  function processMonthlyNode(node) {
    if (!registerMonthlyNode(node)) return;
    const original = monthlyOriginalText.get(node);
    if (typeof original !== "string") return;

    if (!shouldConvertPrices()) {
      if (node.nodeValue !== original) node.nodeValue = original;
      return;
    }
    const m = original.match(MONTHLY_REGEX);
    if (!m) {
      if (node.nodeValue !== original) node.nodeValue = original;
      return;
    }
    const rateInfo = getRateInfo(selectedCurrency);
    if (!rateInfo) {
      if (node.nodeValue !== original) node.nodeValue = original;
      return;
    }

    let amount = monthlyBynAmount.get(node);
    if (!Number.isFinite(amount)) {
      amount = parseBynPrice(m[1]);
      if (amount !== null) monthlyBynAmount.set(node, amount);
    }
    if (amount === null || !Number.isFinite(amount)) {
      if (node.nodeValue !== original) node.nodeValue = original;
      return;
    }

    const replacement = `${formatDisplayPrice(
      convertFromBYN(amount, rateInfo),
      selectedCurrency,
    )}${m[2]}`;
    const next = original.replace(MONTHLY_REGEX, replacement);
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function collectMonthlyNodesFromSubtree(root) {
    if (!root) return;
    if (root.nodeType === NODE_TYPE_TEXT) {
      if (registerMonthlyNode(root)) pendingMonthlyNodes.add(root);
      return;
    }
    if (
      root.nodeType !== NODE_TYPE_ELEMENT &&
      root.nodeType !== NODE_TYPE_DOCUMENT_FRAGMENT
    )
      return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cur = walker.nextNode();
    while (cur) {
      if (registerMonthlyNode(cur)) pendingMonthlyNodes.add(cur);
      cur = walker.nextNode();
    }
  }

  function pruneDisconnectedMonthlyNodes() {
    for (const node of trackedMonthlyNodes) {
      if (node?.isConnected) continue;
      trackedMonthlyNodes.delete(node);
      pendingMonthlyNodes.delete(node);
      monthlyOriginalText.delete(node);
      monthlyBynAmount.delete(node);
    }
  }

  function applyMonthlyPrices() {
    for (const node of trackedMonthlyNodes) processMonthlyNode(node);
  }

  function applyOriginalDaysOnSale() {
    try {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return;
      const data = JSON.parse(el.textContent);
      const days =
        data?.props?.initialState?.advert?.advert?.originalDaysOnSale;
      if (typeof days !== "number") return;
      const suffix = `, всего ${days} дней в продаже`;
      const keywords = [
        "опубликовано",
        "обновлено",
        "часов назад",
        "день назад",
        "дня назад",
        "недель назад",
        "месяц назад",
      ];
      const selectors = [
        ".card__stat-item",
        ".card__date-item",
        ".card__date",
        "[class*='stat'][class*='item']",
        "[class*='date'][class*='item']",
      ];
      for (const sel of selectors) {
        for (const item of document.querySelectorAll(sel)) {
          const text = item.textContent.toLowerCase();
          for (const kw of keywords) {
            if (text.includes(kw)) {
              const cur = item.textContent.trim();
              if (!cur.includes(suffix)) item.textContent = cur + suffix;
              return;
            }
          }
        }
      }
    } catch {}
  }

  function applyAll() {
    applyScheduled = false;
    if (!document.documentElement) {
      pendingMonthlyNodes.clear();
      return;
    }
    if (fullMonthlyScanRequested) {
      if (document.body) collectMonthlyNodesFromSubtree(document.body);
      fullMonthlyScanRequested = false;
    }

    applyElementPrices(collectElementsBySelectors(PRICE_SELECTORS));
    applyMonthlyElementPrices(
      collectElementsBySelectors(MONTHLY_ELEMENT_SELECTORS),
    );
    applyFinanceRangePrices(
      collectElementsBySelectors(FINANCE_RANGE_SELECTORS),
    );
    applyFinanceDescriptionPrices(
      collectElementsBySelectors(FINANCE_DESCRIPTION_SELECTORS),
    );
    applyPriceHistoryDescPrices(
      collectElementsBySelectors(PRICE_HISTORY_DESC_SELECTORS),
    );
    applyStatsSecondaryPrices(
      collectElementsBySelectors(STATS_SECONDARY_SELECTORS),
    );
    applyGraphSumOrItemPrices(
      collectElementsBySelectors(GRAPH_ITEM_PRICE_SELECTORS),
    );
    applyGraphLogDiffPrices(
      collectElementsBySelectors(GRAPH_LOG_DIFF_SELECTORS),
    );
    applyGraphSumOrItemPrices(
      collectElementsBySelectors(GRAPH_LOG_SUM_SELECTORS),
    );
    applySalonPriceSuffixes();

    pruneDisconnectedMonthlyNodes();
    for (const n of pendingMonthlyNodes) trackedMonthlyNodes.add(n);
    pendingMonthlyNodes.clear();
    applyMonthlyPrices();

    applyOriginalDaysOnSale();
  }

  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(applyAll);
    } else {
      setTimeout(applyAll, 0);
    }
  }

  function setupObserver() {
    const root = document.body || document.documentElement;
    if (!root) return;

    function isInside(node, selectors) {
      const parent = node?.parentElement;
      if (!parent?.closest) return false;
      for (const s of selectors) if (parent.closest(s)) return true;
      return false;
    }
    const allWatchedSelectors = [
      ...PRICE_SELECTORS,
      ...MONTHLY_ELEMENT_SELECTORS,
      ...FINANCE_RANGE_SELECTORS,
      ...FINANCE_DESCRIPTION_SELECTORS,
      SALON_PRICE_WRAPPER_SELECTOR,
      ...PRICE_HISTORY_DESC_SELECTORS,
      ...STATS_SECONDARY_SELECTORS,
      ...GRAPH_ITEM_PRICE_SELECTORS,
      ...GRAPH_LOG_DIFF_SELECTORS,
      ...GRAPH_LOG_SUM_SELECTORS,
    ];

    const observer = new MutationObserver((mutations) => {
      let shouldApply = false;
      for (const m of mutations) {
        if (m.type === "characterData") {
          if (registerMonthlyNode(m.target)) {
            pendingMonthlyNodes.add(m.target);
            shouldApply = true;
            continue;
          }
          if (isInside(m.target, allWatchedSelectors)) shouldApply = true;
          continue;
        }
        if (m.type === "childList" && m.addedNodes.length) {
          shouldApply = true;
          for (const n of m.addedNodes) collectMonthlyNodesFromSubtree(n);
        }
      }
      if (shouldApply) scheduleApply();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // 7. Floating widget (замена popup)
  // ──────────────────────────────────────────────────────────────────

  let widgetRoot = null;
  let widgetPanelOpen = false;

  function injectStyles() {
    const style = document.createElement("style");
    style.id = "avc-widget-style";
    style.textContent = `
      #avc-widget {
        position: fixed;
        right: 12px;
        bottom: max(12px, env(safe-area-inset-bottom, 12px));
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
        font-size: 14px;
        color: #fff;
      }
      #avc-widget * { box-sizing: border-box; }
      #avc-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(20, 20, 22, 0.92);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        border: none;
        color: #fff;
        font-weight: 600;
        font-size: 14px;
        min-height: 38px;
      }
      #avc-toggle:active { opacity: 0.85; }
      #avc-panel {
        position: absolute;
        right: 0;
        bottom: 48px;
        width: 240px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(20, 20, 22, 0.95);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      }
      #avc-panel[hidden] { display: none; }
      .avc-row { display: flex; gap: 6px; margin-bottom: 8px; }
      .avc-currency-btn {
        flex: 1;
        padding: 8px 0;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.15);
        background: transparent;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .avc-currency-btn.active {
        background: #ffce4d;
        color: #111;
        border-color: #ffce4d;
      }
      .avc-rates {
        margin: 8px 0;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(255,255,255,0.06);
        font-size: 12px;
        line-height: 1.5;
      }
      .avc-rates-row { display: flex; justify-content: space-between; }
      .avc-rates-label { color: rgba(255,255,255,0.65); }
      .avc-meta {
        font-size: 11px;
        color: rgba(255,255,255,0.55);
        margin-top: 6px;
      }
      .avc-refresh {
        margin-top: 8px;
        width: 100%;
        padding: 8px;
        border-radius: 8px;
        background: rgba(255,255,255,0.1);
        border: none;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .avc-refresh:disabled { opacity: 0.5; }
      .avc-err {
        margin-top: 6px;
        font-size: 11px;
        color: #ff8a8a;
      }
    `;
    document.head.appendChild(style);
  }

  function buildWidget() {
    if (widgetRoot) return;
    injectStyles();
    widgetRoot = document.createElement("div");
    widgetRoot.id = "avc-widget";

    const panel = document.createElement("div");
    panel.id = "avc-panel";
    panel.hidden = true;

    const currencyRow = document.createElement("div");
    currencyRow.className = "avc-row";
    currencyRow.id = "avc-currency-row";
    panel.appendChild(currencyRow);

    const rates = document.createElement("div");
    rates.className = "avc-rates";
    rates.id = "avc-rates";
    panel.appendChild(rates);

    const refresh = document.createElement("button");
    refresh.className = "avc-refresh";
    refresh.id = "avc-refresh";
    refresh.textContent = "Обновить курсы";
    panel.appendChild(refresh);

    const meta = document.createElement("div");
    meta.className = "avc-meta";
    meta.id = "avc-meta";
    panel.appendChild(meta);

    widgetRoot.appendChild(panel);

    const toggle = document.createElement("button");
    toggle.id = "avc-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "AV.by Валюты");

    const toggleLabel = document.createElement("span");
    toggleLabel.id = "avc-toggle-label";
    toggleLabel.textContent = selectedCurrency;
    toggle.appendChild(toggleLabel);

    widgetRoot.appendChild(toggle);

    document.body.appendChild(widgetRoot);

    widgetRoot.querySelector("#avc-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      widgetPanelOpen = !widgetPanelOpen;
      widgetRoot.querySelector("#avc-panel").hidden = !widgetPanelOpen;
    });
    document.addEventListener("click", (e) => {
      if (!widgetPanelOpen) return;
      if (!widgetRoot.contains(e.target)) {
        widgetPanelOpen = false;
        widgetRoot.querySelector("#avc-panel").hidden = true;
      }
    });
    widgetRoot.querySelector("#avc-refresh").addEventListener("click", () => {
      const btn = widgetRoot.querySelector("#avc-refresh");
      btn.disabled = true;
      btn.textContent = "Обновляем…";
      fetchRates({ force: true }).finally(() => {
        btn.disabled = false;
        btn.textContent = "Обновить курсы";
      });
    });
  }

  function renderWidget(error) {
    if (!widgetRoot) return;

    widgetRoot.querySelector("#avc-toggle-label").textContent =
      selectedCurrency;

    const row = widgetRoot.querySelector("#avc-currency-row");
    row.textContent = "";
    for (const c of DISPLAY_CURRENCIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "avc-currency-btn" + (c === selectedCurrency ? " active" : "");
      btn.textContent = c;
      btn.addEventListener("click", () => {
        selectedCurrency = c;
        saveSelectedCurrency(c);
        renderWidget();
        scheduleApply();
      });
      row.appendChild(btn);
    }

    const ratesBox = widgetRoot.querySelector("#avc-rates");
    ratesBox.textContent = "";
    if (ratesData?.rates) {
      for (const code of TARGET_CURRENCIES) {
        const r = ratesData.rates[code];
        if (!r) continue;
        const line = document.createElement("div");
        line.className = "avc-rates-row";
        const left = document.createElement("span");
        left.className = "avc-rates-label";
        left.textContent = SCALE_LABELS[code];
        const right = document.createElement("span");
        right.textContent = `${r.rate.toFixed(4)} BYN`;
        line.appendChild(left);
        line.appendChild(right);
        ratesBox.appendChild(line);
      }
    } else {
      ratesBox.textContent = "Курсы пока не загружены";
    }

    const meta = widgetRoot.querySelector("#avc-meta");
    if (ratesData?.fetchedAt) {
      const d = new Date(ratesData.fetchedAt);
      const t = d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      meta.textContent = `Обновлено: ${t}`;
    } else {
      meta.textContent = "";
    }

    let errLine = widgetRoot.querySelector(".avc-err");
    if (error) {
      if (!errLine) {
        errLine = document.createElement("div");
        errLine.className = "avc-err";
        widgetRoot.querySelector("#avc-panel").appendChild(errLine);
      }
      errLine.textContent = `Ошибка обновления: ${error.message || error}`;
    } else if (errLine) {
      errLine.remove();
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 8. Init
  // ──────────────────────────────────────────────────────────────────

  function start() {
    buildWidget();
    renderWidget();
    setupObserver();
    scheduleApply();
    fetchRates(); // если кэш свежий — no-op, иначе сходит за курсами
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
