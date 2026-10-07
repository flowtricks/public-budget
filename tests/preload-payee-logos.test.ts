import { afterEach, beforeEach, expect, it, vi } from "vitest";
import aliases from "../src/lib/payee-logos.json";
import { payeeLogo } from "../src/lib/payee-logos";

let created: {
  src: string;
  decoding: string;
  decode: ReturnType<typeof vi.fn>;
}[];
let decode: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  created = [];
  decode = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decoding = "";
      decode = decode;
      constructor() {
        created.push(this);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("loads and decodes one image per logo, including aliases and repeated tab visits", async () => {
  const { preloadPayeeLogos } = await import("../src/lib/preload-payee-logos");
  preloadPayeeLogos([
    "Walmart",
    "Wal-Mart",
    "Unknown payee",
    "Another unknown",
  ]);
  preloadPayeeLogos(["Wal Mart", "Walmart"]);
  expect(created.map((image) => image.src)).toEqual([
    payeeLogo("Walmart"),
    payeeLogo("Unknown payee"),
  ]);
  expect(decode).toHaveBeenCalledTimes(2);
});

it("allows a failed offline image to retry without rejecting or blocking navigation", async () => {
  decode.mockRejectedValueOnce(new Error("offline"));
  const { preloadPayeeLogos } = await import("../src/lib/preload-payee-logos");
  expect(() => preloadPayeeLogos(["Walmart"])).not.toThrow();
  await Promise.resolve();
  preloadPayeeLogos(["Walmart"]);
  expect(created).toHaveLength(2);
  expect(decode).toHaveBeenCalledTimes(2);
});

it("bounds decoded image retention and keeps recently used logos", async () => {
  const { preloadPayeeLogos } = await import("../src/lib/preload-payee-logos");
  const names = [
    ...new Map(
      Object.values(aliases)
        .flat()
        .map((name) => [payeeLogo(name), name]),
    ).values(),
  ];
  expect(names.length).toBeGreaterThan(100);
  preloadPayeeLogos(names.slice(0, 100));
  preloadPayeeLogos([names[0]]);
  preloadPayeeLogos([names[100]]);
  expect(created).toHaveLength(101);
  preloadPayeeLogos([names[0]]);
  expect(created).toHaveLength(101);
  preloadPayeeLogos([names[1]]);
  expect(created).toHaveLength(102);
});
