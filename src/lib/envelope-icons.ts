import catalog from "./icon-catalog.json";
export const envelopeIcons = catalog;
const byName = new Map(catalog.map((icon) => [icon.name, icon]));
const legacy: Record<string, string> = {
  ShoppingBasket: "basket",
  Utensils: "fork-knife",
  Car: "car",
  House: "house",
  ShoppingBag: "shopping-bag",
  Zap: "lightning",
  Plane: "airplane",
  Landmark: "bank",
  Wallet: "wallet",
};
export function resolveEnvelopeIcon(name = "wallet") {
  return byName.get(legacy[name] || name) || byName.get("wallet")!;
}
export const iconLabel = (name: string) =>
  name
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
export function searchEnvelopeIcons(query: string) {
  const terms = query
    .toLowerCase()
    .trim()
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean);
  return terms.length
    ? catalog.filter((icon) =>
        terms.every((term) => icon.search.includes(term)),
      )
    : catalog;
}
