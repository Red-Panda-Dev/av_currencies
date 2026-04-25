import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  parseRates,
  convert,
  convertFromBYN,
  parseBynPrice,
  formatDisplayPrice,
  formatRate,
  formatRateLabel,
  formatDate,
  formatTime,
  TARGET_CURRENCIES,
  DISPLAY_CURRENCIES,
  SCALE_LABELS,
  CURRENCY_SYMBOLS,
} from "../lib/rates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "..", "examples", "nbrb_response.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("parseRates", () => {
  it("extracts USD, EUR, RUB from full NBRB response", () => {
    const result = parseRates(fixture);
    expect(result).not.toBeNull();
    expect(result.USD).toBeDefined();
    expect(result.EUR).toBeDefined();
    expect(result.RUB).toBeDefined();
    expect(Object.keys(result)).toHaveLength(3);
  });

  it("parses USD correctly", () => {
    const result = parseRates(fixture);
    expect(result.USD).toEqual({
      code: "USD",
      name: "\u0414\u043e\u043b\u043b\u0430\u0440 \u0421\u0428\u0410",
      scale: 1,
      rate: 2.8186,
    });
  });

  it("parses EUR correctly", () => {
    const result = parseRates(fixture);
    expect(result.EUR).toEqual({
      code: "EUR",
      name: "\u0415\u0432\u0440\u043e",
      scale: 1,
      rate: 3.2937,
    });
  });

  it("parses RUB correctly with scale 100", () => {
    const result = parseRates(fixture);
    expect(result.RUB).toEqual({
      code: "RUB",
      name: "\u0420\u043e\u0441\u0441\u0438\u0439\u0441\u043a\u0438\u0445 \u0440\u0443\u0431\u043b\u0435\u0439",
      scale: 100,
      rate: 3.7556,
    });
  });

  it("returns null for non-array input", () => {
    expect(parseRates({})).toBeNull();
    expect(parseRates("not array")).toBeNull();
    expect(parseRates(null)).toBeNull();
    expect(parseRates(42)).toBeNull();
    expect(parseRates(undefined)).toBeNull();
  });

  it("returns null when a target currency is missing", () => {
    const partial = fixture.filter((item) => item.Cur_Abbreviation !== "USD");
    expect(parseRates(partial)).toBeNull();
  });

  it("returns null when EUR is missing", () => {
    const partial = fixture.filter((item) => item.Cur_Abbreviation !== "EUR");
    expect(parseRates(partial)).toBeNull();
  });

  it("returns null when RUB is missing", () => {
    const partial = fixture.filter((item) => item.Cur_Abbreviation !== "RUB");
    expect(parseRates(partial)).toBeNull();
  });

  it("returns null when all target currencies are missing", () => {
    const noTargets = fixture.filter(
      (item) => !TARGET_CURRENCIES.includes(item.Cur_Abbreviation),
    );
    expect(parseRates(noTargets)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(parseRates([])).toBeNull();
  });
});

describe("convert", () => {
  it("converts 10 USD to BYN", () => {
    const result = convert(10, { rate: 2.8186, scale: 1 });
    expect(result.toFixed(4)).toBe("28.1860");
  });

  it("converts 10 EUR to BYN", () => {
    const result = convert(10, { rate: 3.2937, scale: 1 });
    expect(result.toFixed(4)).toBe("32.9370");
  });

  it("converts 100 RUB to BYN", () => {
    const result = convert(100, { rate: 3.7556, scale: 100 });
    expect(result.toFixed(4)).toBe("3.7556");
  });

  it("converts 1 RUB to BYN", () => {
    const result = convert(1, { rate: 3.7556, scale: 100 });
    expect(result.toFixed(4)).toBe("0.0376");
  });

  it("handles zero amount", () => {
    const result = convert(0, { rate: 2.8186, scale: 1 });
    expect(result).toBe(0);
  });

  it("handles fractional amount", () => {
    const result = convert(0.5, { rate: 2.8186, scale: 1 });
    expect(result.toFixed(4)).toBe("1.4093");
  });

  it("handles large amount", () => {
    const result = convert(10000, { rate: 2.8186, scale: 1 });
    expect(result.toFixed(4)).toBe("28186.0000");
  });
});

describe("convertFromBYN", () => {
  it("converts BYN to USD", () => {
    const result = convertFromBYN(72990, { rate: 2.8186, scale: 1 });
    expect(result.toFixed(2)).toBe("25895.83");
  });

  it("converts BYN to EUR", () => {
    const result = convertFromBYN(80330, { rate: 3.2937, scale: 1 });
    expect(result.toFixed(2)).toBe("24388.99");
  });

  it("converts BYN to RUB and respects scale 100", () => {
    const result = convertFromBYN(72990, { rate: 3.7556, scale: 100 });
    expect(result.toFixed(2)).toBe("1943497.71");
  });
});

describe("parseBynPrice", () => {
  it("parses BYN price with suffix", () => {
    expect(parseBynPrice("72 990 р.")).toBe(72990);
  });

  it("parses price with non-breaking spaces", () => {
    expect(parseBynPrice("82\u00A0981 р.")).toBe(82981);
    expect(parseBynPrice("82\u202F981 р.")).toBe(82981);
  });

  it("parses salon format with prefix", () => {
    expect(parseBynPrice("от 80 330")).toBe(80330);
  });

  it("parses monthly format", () => {
    expect(parseBynPrice("1386 BYN в месяц")).toBe(1386);
  });

  it("parses comma decimals", () => {
    expect(parseBynPrice("25 895,83 $")).toBe(25895.83);
  });

  it("returns null for invalid values", () => {
    expect(parseBynPrice(100)).toBeNull();
    expect(parseBynPrice("без цены")).toBeNull();
  });
});

describe("formatDisplayPrice", () => {
  function normalizeSpaces(value) {
    return value.replace(/[\u00A0\u202F]/g, " ");
  }

  it("formats USD rounded with suffix", () => {
    expect(normalizeSpaces(formatDisplayPrice(25895.83, "USD"))).toBe(
      "25 896 $",
    );
  });

  it("formats EUR rounded with suffix", () => {
    expect(normalizeSpaces(formatDisplayPrice(24388.38, "EUR"))).toBe(
      "24 388 €",
    );
  });

  it("formats RUB with text label", () => {
    expect(normalizeSpaces(formatDisplayPrice(1943464.69, "RUB"))).toBe(
      "1 943 465 RUB",
    );
  });

  it("uses currency code for unknown symbols", () => {
    expect(normalizeSpaces(formatDisplayPrice(1234.2, "AUD"))).toBe(
      "1 234 AUD",
    );
  });
});

describe("formatRate", () => {
  it("formats to 4 decimal places", () => {
    expect(formatRate(2.8186)).toBe("2.8186");
  });

  it("pads with zeros", () => {
    expect(formatRate(2.5)).toBe("2.5000");
  });

  it("formats zero", () => {
    expect(formatRate(0)).toBe("0.0000");
  });
});

describe("formatRateLabel", () => {
  it("formats USD label", () => {
    expect(formatRateLabel({ code: "USD", rate: 2.8186 })).toBe(
      "2.8186 BYN за 1 USD",
    );
  });

  it("formats EUR label", () => {
    expect(formatRateLabel({ code: "EUR", rate: 3.2937 })).toBe(
      "3.2937 BYN за 1 EUR",
    );
  });

  it("formats RUB label", () => {
    expect(formatRateLabel({ code: "RUB", rate: 3.7556 })).toBe(
      "3.7556 BYN за 100 RUB",
    );
  });
});

describe("SCALE_LABELS", () => {
  it("has labels for all target currencies", () => {
    for (const cur of TARGET_CURRENCIES) {
      expect(SCALE_LABELS[cur]).toBeDefined();
    }
  });
});

describe("DISPLAY_CURRENCIES", () => {
  it("includes BYN and all target currencies", () => {
    expect(DISPLAY_CURRENCIES).toEqual(["BYN", "USD", "EUR", "RUB"]);
  });
});

describe("CURRENCY_SYMBOLS", () => {
  it("contains symbols for all display currencies", () => {
    for (const cur of DISPLAY_CURRENCIES) {
      expect(CURRENCY_SYMBOLS[cur]).toBeDefined();
    }
  });
});

describe("formatDate", () => {
  it("formats ISO date string", () => {
    const result = formatDate("2026-04-25T00:00:00");
    expect(result).toContain("2026");
  });

  it("returns dash for null", () => {
    expect(formatDate(null)).toBe("\u2014");
  });

  it("returns dash for undefined", () => {
    expect(formatDate(undefined)).toBe("\u2014");
  });
});

describe("formatTime", () => {
  it("formats timestamp", () => {
    const ts = new Date(2026, 3, 25, 14, 30).getTime();
    const result = formatTime(ts);
    expect(result).toContain("14");
    expect(result).toContain("30");
  });

  it("returns empty string for null", () => {
    expect(formatTime(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatTime(undefined)).toBe("");
  });
});
