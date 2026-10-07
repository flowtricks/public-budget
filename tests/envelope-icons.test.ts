import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { icons } from "@phosphor-icons/core";
import {
  envelopeIcons,
  resolveEnvelopeIcon,
  searchEnvelopeIcons,
} from "../src/lib/envelope-icons";
import { EnvelopeSchema, emptyState, settings } from "../shared/model";
import { exportCSV, parseRestore } from "../src/lib/csv";

describe("envelope icon catalog", () => {
  it("offers every Phosphor icon with the exact glyph from the bundled font stylesheet", () => {
    const css = readFileSync(
      "node_modules/@phosphor-icons/web/src/regular/style.css",
      "utf8",
    );
    for (const icon of icons) {
      const item = envelopeIcons.find((entry) => entry.name === icon.name);
      expect(item, icon.name).toBeDefined();
      const match = css.match(
        new RegExp(
          "\\.ph\\.ph-" +
            icon.name +
            ':before\\s*\\{\\s*content: "\\\\([\\da-f]+)";',
        ),
      );
      expect(item!.codepoint, icon.name).toBe(parseInt(match![1], 16));
    }
  });
  it("maps existing icons and supports keyword search and safe fallbacks", () => {
    expect(resolveEnvelopeIcon("ShoppingBasket").name).toBe("basket");
    expect(resolveEnvelopeIcon("Utensils").name).toBe("fork-knife");
    expect(resolveEnvelopeIcon("Plane").name).toBe("airplane");
    expect(resolveEnvelopeIcon("unknown").name).toBe("wallet");
    expect(searchEnvelopeIcons("groceries").length).toBeGreaterThan(0);
    expect(searchEnvelopeIcons("building-office").map((i) => i.name)).toContain(
      "building-office",
    );
    expect(searchEnvelopeIcons("nonexistentxyz")).toEqual([]);
  });
  it("validates and restores every selectable icon, including long names", () => {
    const state = emptyState();
    for (const icon of envelopeIcons) {
      state.records[icon.name] = EnvelopeSchema.parse({
        id: icon.name,
        kind: "envelope",
        version: 0,
        name: icon.name,
        target: 0,
        opening: 0,
        color: "green",
        order: 0,
        archived: false,
        icon: icon.name,
      });
    }
    state.records.settings = { ...settings(state), fallbackId: "wallet" };
    expect(parseRestore(exportCSV(state)).state).toEqual(state);
  });
});
