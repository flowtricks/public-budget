import { icons } from "@phosphor-icons/core";
import { readFile, writeFile } from "node:fs/promises";
const css = await readFile(
  new URL(
    "../node_modules/@phosphor-icons/web/src/regular/style.css",
    import.meta.url,
  ),
  "utf8",
);
const glyphs = new Map(
  [
    ...css.matchAll(
      /\.ph\.ph-([\w-]+):before\s*\{\s*content: "\\([\da-f]+)";/g,
    ),
  ].map((m) => [m[1], parseInt(m[2], 16)]),
);
for (const icon of icons) {
  if (!glyphs.has(icon.name))
    throw new Error(`Missing Phosphor glyph: ${icon.name}`);
}
const aliases = new Set(icons.flatMap((i) => (i.alias ? [i.alias.name] : [])));
const metadata = new Map(icons.map((i) => [i.name, i]));
const catalog = [...glyphs]
  .filter(([name]) => !aliases.has(name))
  .map(([name, codepoint]) => {
    const icon = metadata.get(name);
    return {
      name,
      codepoint,
      search: [
        name.replaceAll("-", " "),
        ...(icon?.tags || []),
        ...(icon?.categories || []),
        icon?.alias?.name || "",
      ]
        .join(" ")
        .toLowerCase(),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
await writeFile(
  new URL("../src/lib/icon-catalog.json", import.meta.url),
  JSON.stringify(catalog),
);
console.log(`Prepared ${catalog.length} Phosphor icons for offline use.`);
