(function initAvByCurrencyConversion() {
  if (typeof browser === "undefined" || !browser.storage?.local) return;

  const DEFAULT_DISPLAY_CURRENCY = "BYN";
  const DISPLAY_CURRENCIES = new Set(["BYN", "USD", "EUR", "RUB"]);
  const CURRENCY_SYMBOLS = { BYN: "р.", USD: "$", EUR: "€", RUB: "RUB" };
  const STORAGE_KEYS = ["ratesData", "selectedCurrency"];

  const PRICE_SELECTORS = [
    ".listing-index__price",
    ".card__price-button",
    ".listing-top__price-primary",
    ".featured__price-value strong",
    ".salon-listing-top__prices > div",
  ];

  const MONTHLY_REGEX =
    /(\d[\d\s\u00A0\u202F]*(?:[.,]\d+)?)\s*BYN(\s*в\s*месяц)/i;
  const MONTHLY_MARKER_REGEX = /BYN\s*в\s*месяц/i;
  const SKIP_TEXT_NODE_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "TITLE",
  ]);

  const ATTR_ORIGINAL_TEXT = "avCurrenciesOriginalText";
  const ATTR_BYN_AMOUNT = "avCurrenciesBynAmount";

  const monthlyOriginalText = new WeakMap();
  const monthlyBynAmount = new WeakMap();

  let ratesData = null;
  let selectedCurrency = DEFAULT_DISPLAY_CURRENCY;
  let applyScheduled = false;

  function normalizeCurrency(value) {
    if (DISPLAY_CURRENCIES.has(value)) return value;
    return DEFAULT_DISPLAY_CURRENCY;
  }

  function parseBynPrice(value) {
    if (typeof value !== "string") return null;

    const match = value.match(/\d[\d\s\u00A0\u202F]*(?:[.,]\d+)?/);
    if (!match) return null;

    const normalized = match[0]
      .replace(/[\s\u00A0\u202F]/g, "")
      .replace(",", ".");
    const amount = Number.parseFloat(normalized);

    return Number.isFinite(amount) ? amount : null;
  }

  function convertFromBYN(amount, rateInfo) {
    return (amount * rateInfo.scale) / rateInfo.rate;
  }

  function formatDisplayPrice(amount, currencyCode) {
    const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode;
    const formatted = new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0,
    }).format(Math.round(amount));
    return `${formatted} ${symbol}`;
  }

  function getRateInfo(currencyCode) {
    return ratesData?.rates?.[currencyCode] || null;
  }

  function shouldConvertPrices() {
    if (selectedCurrency === DEFAULT_DISPLAY_CURRENCY) return false;
    return Boolean(getRateInfo(selectedCurrency));
  }

  function collectPriceElements() {
    if (!document || typeof document.querySelectorAll !== "function") {
      return [];
    }

    const elements = new Set();

    for (const selector of PRICE_SELECTORS) {
      const list = document.querySelectorAll(selector);
      for (const element of list) {
        elements.add(element);
      }
    }

    return [...elements];
  }

  function getOriginalElementText(element) {
    if (!element.dataset[ATTR_ORIGINAL_TEXT]) {
      element.dataset[ATTR_ORIGINAL_TEXT] = element.textContent || "";
    }
    return element.dataset[ATTR_ORIGINAL_TEXT];
  }

  function getElementBynAmount(element, originalText) {
    if (element.dataset[ATTR_BYN_AMOUNT]) {
      const cached = Number.parseFloat(element.dataset[ATTR_BYN_AMOUNT]);
      if (Number.isFinite(cached)) return cached;
    }

    const parsed = parseBynPrice(originalText);
    if (parsed !== null) {
      element.dataset[ATTR_BYN_AMOUNT] = String(parsed);
    }
    return parsed;
  }

  function applyElementPrices() {
    const elements = collectPriceElements();
    const canConvert = shouldConvertPrices();
    const rateInfo = canConvert ? getRateInfo(selectedCurrency) : null;

    for (const element of elements) {
      const originalText = getOriginalElementText(element);
      let nextText = originalText;

      if (!canConvert || !rateInfo) {
        if (element.textContent !== nextText) {
          element.textContent = nextText;
        }
        continue;
      }

      const bynAmount = getElementBynAmount(element, originalText);
      if (bynAmount === null) {
        if (element.textContent !== nextText) {
          element.textContent = nextText;
        }
        continue;
      }

      const converted = convertFromBYN(bynAmount, rateInfo);
      nextText = formatDisplayPrice(converted, selectedCurrency);
      if (element.textContent !== nextText) {
        element.textContent = nextText;
      }
    }
  }

  function processMonthlyNode(node) {
    if (!node || typeof node.nodeValue !== "string") return;

    const parentTag = node.parentElement?.tagName;
    if (parentTag && SKIP_TEXT_NODE_TAGS.has(parentTag)) return;

    const existingOriginal = monthlyOriginalText.get(node);
    const currentText = node.nodeValue;

    if (!existingOriginal && !MONTHLY_MARKER_REGEX.test(currentText)) {
      return;
    }

    const originalText = existingOriginal || currentText;
    if (!existingOriginal) {
      monthlyOriginalText.set(node, originalText);
    }

    if (!shouldConvertPrices()) {
      if (node.nodeValue !== originalText) {
        node.nodeValue = originalText;
      }
      return;
    }

    const match = originalText.match(MONTHLY_REGEX);
    if (!match) {
      if (node.nodeValue !== originalText) {
        node.nodeValue = originalText;
      }
      return;
    }

    const rateInfo = getRateInfo(selectedCurrency);
    if (!rateInfo) {
      if (node.nodeValue !== originalText) {
        node.nodeValue = originalText;
      }
      return;
    }

    let bynAmount = monthlyBynAmount.get(node);
    if (!Number.isFinite(bynAmount)) {
      bynAmount = parseBynPrice(match[1]);
      if (bynAmount !== null) {
        monthlyBynAmount.set(node, bynAmount);
      }
    }

    if (bynAmount === null || !Number.isFinite(bynAmount)) {
      if (node.nodeValue !== originalText) {
        node.nodeValue = originalText;
      }
      return;
    }

    const converted = convertFromBYN(bynAmount, rateInfo);
    const replacement = `${formatDisplayPrice(converted, selectedCurrency)}${match[2]}`;
    const nextText = originalText.replace(MONTHLY_REGEX, replacement);
    if (node.nodeValue !== nextText) {
      node.nodeValue = nextText;
    }
  }

  function applyMonthlyPrices() {
    if (!document || !document.body) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const nodes = [];
    let current = walker.nextNode();

    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }

    for (const node of nodes) {
      processMonthlyNode(node);
    }
  }

  function applyAll() {
    applyScheduled = false;
    applyElementPrices();
    applyMonthlyPrices();
  }

  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(applyAll);
      return;
    }

    setTimeout(applyAll, 0);
  }

  function setupObserver() {
    if (!document) return;

    const root = document.documentElement;
    if (!root) return;

    const observer = new MutationObserver(() => {
      scheduleApply();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function setupStorageListener() {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (changes.ratesData) {
        ratesData = changes.ratesData.newValue || null;
      }

      if (changes.selectedCurrency) {
        selectedCurrency = normalizeCurrency(changes.selectedCurrency.newValue);
      }

      if (changes.ratesData || changes.selectedCurrency) {
        scheduleApply();
      }
    });
  }

  async function init() {
    try {
      const stored = await browser.storage.local.get(STORAGE_KEYS);
      ratesData = stored.ratesData || null;
      selectedCurrency = normalizeCurrency(stored.selectedCurrency);
      scheduleApply();
      setupObserver();
      setupStorageListener();
    } catch (_err) {
      // Ignore storage errors in content context.
    }
  }

  init();
})();
