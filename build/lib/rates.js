const TARGET_CURRENCIES = ["USD", "EUR", "RUB"];
const DISPLAY_CURRENCIES = ["BYN", "USD", "EUR", "RUB"];

const SCALE_LABELS = { USD: "1 USD", EUR: "1 EUR", RUB: "100 RUB" };
const CURRENCY_SYMBOLS = { BYN: "р.", USD: "$", EUR: "€", RUB: "RUB" };

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

  for (const cur of TARGET_CURRENCIES) {
    if (!rates[cur]) return null;
  }

  return rates;
}

function convert(amount, rateInfo) {
  return (amount * rateInfo.rate) / rateInfo.scale;
}

function convertFromBYN(amount, rateInfo) {
  return (amount * rateInfo.scale) / rateInfo.rate;
}

function formatRate(value) {
  return value.toFixed(4);
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

function formatDisplayPrice(amount, currencyCode) {
  const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode;
  const rounded = Math.round(amount);
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(rounded);
  return `${formatted} ${symbol}`;
}

function formatRateLabel(rateInfo) {
  const label = SCALE_LABELS[rateInfo.code];
  return `${formatRate(rateInfo.rate)} BYN за ${label}`;
}

function formatDate(isoString) {
  if (!isoString) return "\u2014";
  const d = new Date(isoString);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export {
  TARGET_CURRENCIES,
  DISPLAY_CURRENCIES,
  SCALE_LABELS,
  CURRENCY_SYMBOLS,
  parseRates,
  convert,
  convertFromBYN,
  parseBynPrice,
  formatDisplayPrice,
  formatRate,
  formatRateLabel,
  formatDate,
  formatTime,
};
