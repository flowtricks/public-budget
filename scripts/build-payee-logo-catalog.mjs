import { readFile, readdir, writeFile } from "node:fs/promises";

const aliases = JSON.parse(
  await readFile(
    new URL("../src/lib/payee-logos.json", import.meta.url),
    "utf8",
  ),
);
const files = new Set(
  await readdir(new URL("../public/payee-logos/", import.meta.url)),
);
const assets = {};
for (const key of Object.keys(aliases).sort()) {
  // Prefer vector artwork, then PNG, then JPEG whenever multiple files exist.
  const filename = ["svg", "png", "jpg", "jpeg", "webp"]
    .map((extension) => `${key.toLowerCase()}.${extension}`)
    .find((filename) => files.has(filename));
  if (filename) assets[key.toLowerCase()] = filename;
}
await writeFile(
  new URL("../src/lib/payee-logo-assets.json", import.meta.url),
  JSON.stringify(assets, null, 2) + "\n",
);
console.log(
  `Prepared ${Object.keys(assets).length} payee logos (SVG → PNG → JPG).`,
);
