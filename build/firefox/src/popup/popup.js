globalThis.browser ??= globalThis.chrome;

import {
  DISPLAY_CURRENCIES,
  SCALE_LABELS,
  convert,
  formatTime,
} from "../lib/rates.js";

function formatRateDisplay(value) {
  return value.toFixed(3);
}

function formatRateLabelDisplay(rateInfo) {
  const label = SCALE_LABELS[rateInfo.code];
  return `${formatRateDisplay(rateInfo.rate)} BYN за ${label}`;
}

let customRates = {};

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
  vinFeatureEnabled: document.getElementById("vin-feature-enabled"),
};

const DEFAULT_DISPLAY_CURRENCY = "BYN";
const VIN_FEATURE_STORAGE_KEY = "vinFeatureEnabled";

function getEffectiveRatesData(ratesData) {
  if (!ratesData || !ratesData.rates) return ratesData;
  const rates = {};
  for (const [code, info] of Object.entries(ratesData.rates)) {
    rates[code] = {
      ...info,
      rate: customRates[code] != null ? customRates[code] : info.rate,
    };
  }
  return { ...ratesData, rates };
}

function renderRates(ratesData) {
  if (!ratesData || !ratesData.rates) {
    els.ratesSection.hidden = true;
    els.converterSection.hidden = true;
    return;
  }

  const effective = getEffectiveRatesData(ratesData);
  const { rates } = effective;

  const rows = els.ratesSection.querySelectorAll(".rate-row");
  const rateEls = { USD: els.rateUsd, EUR: els.rateEur, RUB: els.rateRub };

  for (const row of rows) {
    const code = row.querySelector(".rate-row__edit")?.dataset.currency;
    if (!code || !rateEls[code]) continue;
    if (customRates[code] != null) {
      row.classList.add("rate-row--custom");
    } else {
      row.classList.remove("rate-row--custom");
    }
    rateEls[code].textContent = formatRateLabelDisplay(rates[code]);
  }

  els.ratesSection.hidden = false;
  els.converterSection.hidden = false;
}

function renderConverter(ratesData) {
  if (!ratesData || !ratesData.rates) {
    els.converterResult.textContent = "";
    return;
  }

  const effective = getEffectiveRatesData(ratesData);
  const amount = parseFloat(els.converterAmount.value) || 0;
  const currency = els.converterCurrency.value;
  const rateInfo = effective.rates[currency];

  if (!rateInfo) {
    els.converterResult.textContent = "";
    return;
  }

  const result = convert(amount, rateInfo);
  els.converterResult.textContent = `= ${result.toFixed(2)} BYN`;
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
    customRates = {};
    const stored = await loadData();
    render(stored);
  } finally {
    els.refreshBtn.disabled = false;
  }
}

async function loadCustomRates() {
  const response = await browser.runtime.sendMessage({
    action: "getCustomRates",
  });
  customRates = response?.customRates || {};
}

function enterEditMode(row, currency) {
  if (row.classList.contains("rate-row--editing")) return;

  const valueEl = row.querySelector(".rate-row__value");
  const editBtn = row.querySelector(".rate-row__edit");
  const currentRate =
    customRates[currency] != null
      ? customRates[currency]
      : parseFloat(
          valueEl.textContent.replace(",", ".").replace(/[^\d.]/g, ""),
        );

  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.001";
  input.min = "0.001";
  input.className = "rate-row__input";
  input.value = isNaN(currentRate) ? "" : currentRate;
  input.setAttribute("aria-label", `Новый курс ${currency}`);

  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "rate-row__accept";
  acceptBtn.textContent = "✓";
  acceptBtn.setAttribute("aria-label", `Сохранить курс ${currency}`);

  const dropBtn = document.createElement("button");
  dropBtn.type = "button";
  dropBtn.className = "rate-row__drop";
  dropBtn.textContent = "✕";
  dropBtn.setAttribute("aria-label", `Отменить изменение курса ${currency}`);

  row.classList.add("rate-row--editing");
  row.insertBefore(input, editBtn);
  row.insertBefore(acceptBtn, editBtn);
  row.insertBefore(dropBtn, editBtn);
  input.focus();
  input.select();

  async function save() {
    const newRate = parseFloat(input.value);
    if (!isNaN(newRate) && newRate > 0) {
      await browser.runtime.sendMessage({
        action: "saveCustomRate",
        currency,
        rate: newRate,
      });
      customRates[currency] = newRate;
    }
    exitEditMode(row, input, acceptBtn, dropBtn);
    const stored = await loadData();
    render(stored);
  }

  let blurSave = true;

  function dismiss() {
    exitEditMode(row, input, acceptBtn, dropBtn);
  }

  async function cancel() {
    blurSave = false;
    await browser.runtime.sendMessage({
      action: "clearCustomRate",
      currency,
    });
    delete customRates[currency];
    exitEditMode(row, input, acceptBtn, dropBtn);
    const stored = await loadData();
    render(stored);
  }

  acceptBtn.addEventListener("click", (e) => {
    e.preventDefault();
    save();
  });

  dropBtn.addEventListener("click", (e) => {
    e.preventDefault();
    cancel();
  });

  acceptBtn.addEventListener("mousedown", () => {
    blurSave = false;
  });

  dropBtn.addEventListener("mousedown", () => {
    blurSave = false;
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      blurSave = false;
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      blurSave = false;
      dismiss();
    }
  });

  input.addEventListener("blur", () => {
    if (blurSave && row.classList.contains("rate-row--editing")) {
      dismiss();
    }
  });
}

function exitEditMode(row, input, acceptBtn, dropBtn) {
  row.classList.remove("rate-row--editing");
  if (input && input.parentNode) {
    input.remove();
  }
  if (acceptBtn && acceptBtn.parentNode) {
    acceptBtn.remove();
  }
  if (dropBtn && dropBtn.parentNode) {
    dropBtn.remove();
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

async function loadVinFeatureEnabled() {
  const stored = await browser.storage.local.get(VIN_FEATURE_STORAGE_KEY);
  return stored[VIN_FEATURE_STORAGE_KEY] === true;
}

async function persistVinFeatureEnabled(enabled) {
  await browser.storage.local.set({
    [VIN_FEATURE_STORAGE_KEY]: enabled === true,
  });
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

els.ratesSection.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".rate-row__edit");
  if (!editBtn) return;
  const row = editBtn.closest(".rate-row");
  if (!row) return;
  const currency = editBtn.dataset.currency;
  if (!currency) return;
  enterEditMode(row, currency);
});

els.refreshBtn.addEventListener("click", refreshRates);
els.displayCurrency.addEventListener("change", (event) => {
  persistDisplayCurrency(event.target.value);
});
els.vinFeatureEnabled.addEventListener("change", (event) => {
  persistVinFeatureEnabled(event.target.checked);
});

document.addEventListener("DOMContentLoaded", async () => {
  const selectedCurrency = await loadDisplayCurrency();
  const vinFeatureEnabled = await loadVinFeatureEnabled();
  els.displayCurrency.value = selectedCurrency;
  els.vinFeatureEnabled.checked = vinFeatureEnabled;

  if (selectedCurrency === DEFAULT_DISPLAY_CURRENCY) {
    await persistDisplayCurrency(DEFAULT_DISPLAY_CURRENCY);
  }

  await loadCustomRates();

  const stored = await loadData();
  if (!stored.ratesData) {
    els.loading.hidden = false;
    await refreshRates();
  } else {
    render(stored);
  }
});
