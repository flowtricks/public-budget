import { describe, expect, it } from "vitest";
import { cardArt } from "../src/lib/card-art";
import { bankCardAccount } from "../worker/card-product";

describe("card artwork matching", () => {
  it("matches known product names without inferring from account numbers", () => {
    expect(cardArt("Chase Sapphire Preferred")).toBe("/card-art/sapphire-preferred.png");
    expect(cardArt("Southwest Rapid Rewards Priority")).toBe("/card-art/southwest-priority.png");
    expect(cardArt("Southwest Rapid Rewards")).toBeUndefined();
    expect(cardArt("VentureOne")).toBe("/card-art/ventureone.png");
  });

  it("uses the account details provided by the bank", () => {
    const account = bankCardAccount({
      account_id: "example-account",
      name: "Example Card",
      official_name: "Chase Sapphire Preferred",
      mask: "1234",
      type: "credit",
    }, "Chase");
    expect(account?.officialName).toBe("Chase Sapphire Preferred");
    expect(cardArt(account?.officialName || "")).toBe("/card-art/sapphire-preferred.png");
    expect(account?.productName).toBeUndefined();
  });
});
