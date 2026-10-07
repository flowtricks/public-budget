import aliases from "./payee-logos.json";
import assets from "./payee-logo-assets.json";

export const fallbackPayeeLogo = "/payee-logos/fallback.svg";

const logoFiles: Record<string, string> = assets;
const domainByName = new Map<string, string>();

export function normalizePayeeName(name: string) {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

for (const [domain, names] of Object.entries(aliases)) {
  if (!logoFiles[domain.toLowerCase()]) continue;
  for (const name of names)
    domainByName.set(normalizePayeeName(name), domain.toLowerCase());
}

export function payeeLogo(name: string) {
  const normalized = normalizePayeeName(name);
  const domain =
    domainByName.get(normalized) ??
    (normalized.startsWith("aliexpress") && logoFiles.aliexpress
      ? "aliexpress"
      : undefined);
  return domain ? `/payee-logos/${logoFiles[domain]}` : fallbackPayeeLogo;
}
