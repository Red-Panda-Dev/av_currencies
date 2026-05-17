globalThis.browser ??= globalThis.chrome;

import {
  DISPLAY_CURRENCIES,
  SCALE_LABELS,
  convert,
  formatRate,
  formatRateLabel,
  formatTime,
} from "../lib/rates.js";

const els = {
  ratesSection: document.getElementById("rates-section"),
  loading: document.getElementById("loading"),
  errorSection: document.getElementById("error-section"),
  errorText: document.getElementById("error-text"),
  status: document.getElementById("status"),
  rateUsd: document.getElementById("rate-usd"),
  rateEur: document.getElementById("rate-eur"),
  rateRub: document.getElementById("rate-rub"),
  converterSection: document.getElementById("converter-section"),
  converterAmount: document.getElementById("converter-amount"),
  converterCurrency: document.getElementById("converter-currency"),
  converterResult: document.getElementById("converter-result"),
  updatedAt: document.getElementById("updated-at"),
  refreshBtn: document.getElementById("refresh-btn"),
  displayCurrency: document.getElementById("display-currency"),
};

const DEFAULT_DISPLAY_CURRENCY = "BYN";

function renderRates(ratesData) {
  if (!ratesData || !ratesData.rates) {
    els.ratesSection.hidden = true;
    els.converterSection.hidden = true;
    return;
  }

  const { rates } = ratesData;

  els.rateUsd.textContent = formatRateLabel(rates.USD);
  els.rateEur.textContent = formatRateLabel(rates.EUR);
  els.rateRub.textContent = formatRateLabel(rates.RUB);

  els.ratesSection.hidden = false;
  els.converterSection.hidden = false;
}

function renderConverter(ratesData) {
  if (!ratesData || !ratesData.rates) {
    els.converterResult.textContent = "";
    return;
  }

  const amount = parseFloat(els.converterAmount.value) || 0;
  const currency = els.converterCurrency.value;
  const rateInfo = ratesData.rates[currency];

  if (!rateInfo) {
    els.converterResult.textContent = "";
    return;
  }

  const result = convert(amount, rateInfo);
  els.converterResult.textContent = `= ${formatRate(result)} BYN`;
}

function renderStatus(lastError, ratesData) {
  if (lastError) {
    els.status.textContent =
      "\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u044b \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435";
    els.status.className = "header__status header__status--warning";
  } else if (ratesData) {
    els.status.textContent = "";
    els.status.className = "header__status";
  }
}

function renderUpdatedAt(ratesData) {
  if (ratesData && ratesData.fetchedAt) {
    els.updatedAt.textContent = `\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e: ${formatTime(ratesData.fetchedAt)}`;
  } else {
    els.updatedAt.textContent = "";
  }
}

function render({ ratesData, lastError }) {
  els.loading.hidden = true;

  if (!ratesData && !lastError) {
    els.loading.hidden = false;
    return;
  }

  if (!ratesData && lastError) {
    els.errorSection.hidden = false;
    els.errorText.textContent = lastError.message;
    els.ratesSection.hidden = true;
    els.converterSection.hidden = true;
    return;
  }

  els.errorSection.hidden = true;
  if (lastError) {
    els.errorSection.hidden = false;
    els.errorText.textContent = lastError.message;
  }

  renderRates(ratesData);
  renderConverter(ratesData);
  renderStatus(lastError, ratesData);
  renderUpdatedAt(ratesData);
}

async function loadData() {
  return browser.runtime.sendMessage({ action: "getRates" });
}

async function refreshRates() {
  els.refreshBtn.disabled = true;
  try {
    await browser.runtime.sendMessage({ action: "refreshRates" });
    const stored = await loadData();
    render(stored);
  } finally {
    els.refreshBtn.disabled = false;
  }
}

async function loadDisplayCurrency() {
  const { selectedCurrency } =
    await browser.storage.local.get("selectedCurrency");
  if (!DISPLAY_CURRENCIES.includes(selectedCurrency)) {
    return DEFAULT_DISPLAY_CURRENCY;
  }
  return selectedCurrency;
}

async function persistDisplayCurrency(value) {
  if (!DISPLAY_CURRENCIES.includes(value)) return;
  await browser.storage.local.set({ selectedCurrency: value });
}

els.converterAmount.addEventListener("input", () => {
  browser.storage.local.get("ratesData").then(({ ratesData }) => {
    renderConverter(ratesData);
  });
});

els.converterCurrency.addEventListener("change", () => {
  browser.storage.local.get("ratesData").then(({ ratesData }) => {
    renderConverter(ratesData);
  });
});

els.refreshBtn.addEventListener("click", refreshRates);
els.displayCurrency.addEventListener("change", (event) => {
  persistDisplayCurrency(event.target.value);
});

document.addEventListener("DOMContentLoaded", async () => {
  const selectedCurrency = await loadDisplayCurrency();
  els.displayCurrency.value = selectedCurrency;

  if (selectedCurrency === DEFAULT_DISPLAY_CURRENCY) {
    await persistDisplayCurrency(DEFAULT_DISPLAY_CURRENCY);
  }

  const stored = await loadData();
  if (!stored.ratesData) {
    els.loading.hidden = false;
    await refreshRates();
  } else {
    render(stored);
  }
});
