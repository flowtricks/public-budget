// Product artwork is bundled locally so card details also work offline.
// Chase: creditcards.chase.com; Capital One: ecm.capitalone.com.
export function cardArt(name: string): string | undefined {
  const normalized = name.toLowerCase();
  if (normalized.includes("sapphire preferred"))
    return "/card-art/sapphire-preferred.png";
  if (
    normalized.includes("quicksilver") &&
    !normalized.includes("quicksilverone")
  )
    return "/card-art/quicksilver.png";
  if (normalized.includes("ventureone") && !normalized.includes("business"))
    return "/card-art/ventureone.png";
  if (normalized.includes("southwest")) {
    if (normalized.includes("priority"))
      return "/card-art/southwest-priority.png";
    if (normalized.includes("premier"))
      return "/card-art/southwest-premier.png";
    if (normalized.includes("plus")) return "/card-art/southwest-plus.png";
  }
}
