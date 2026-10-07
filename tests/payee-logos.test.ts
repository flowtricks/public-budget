import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fallbackPayeeLogo, payeeLogo } from "../src/lib/payee-logos";
import assets from "../src/lib/payee-logo-assets.json";

describe("payee logos", () => {
  it("uses common merchant spelling variants", () => {
    expect(payeeLogo("Wal Mart")).toBe(payeeLogo("Walmart"));
    expect(payeeLogo("Chick Fil A")).toBe(payeeLogo("Chick-fil-A"));
    expect(payeeLogo("Exxon Mobil")).toBe("/payee-logos/exxonmobil.com.svg");
  });

  it("uses bundled logos for public brands", () => {
    expect(payeeLogo("Subway")).toBe("/payee-logos/subway-choicemark.png");
    expect(payeeLogo("Protective Life")).toBe("/payee-logos/protective-life.png");
  });

  it("falls back for unknown payees", () => {
    expect(payeeLogo("Unknown person")).toBe(fallbackPayeeLogo);
    expect(payeeLogo("A new payee")).toBe(fallbackPayeeLogo);
  });

  it("uses AliExpress artwork for names beginning with AliExpress", () => {
    expect(payeeLogo("AliExpress order")).toBe("/payee-logos/aliexpress.webp");
    expect(payeeLogo("Refund from AliExpress")).toBe(fallbackPayeeLogo);
  });

  it("has a local file for every declared logo", () => {
    for (const [domain, filename] of Object.entries(assets)) {
      const path = fileURLToPath(new URL(`../public/payee-logos/${filename}`, import.meta.url));
      expect(existsSync(path), domain).toBe(true);
    }
  });
});
