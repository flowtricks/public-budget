import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CardSource from "../src/components/CardSource";
import type { Transaction } from "../shared/model";

vi.mock("../src/lib/store", () => ({ api: vi.fn() }));

const bankTransaction = {
  source: "bank",
  sourceAccount: "Chase · Example user",
  bankOriginal: {
    accountId: "card1",
    account: {
      id: "card1",
      name: "Sapphire Preferred",
      officialName: "Chase Sapphire Preferred",
      mask: "1234",
      type: "credit",
    },
  },
} as Transaction;

describe("transaction card row", () => {
  it("shows the card name, design thumbnail, and mask for an automatic charge", () => {
    const markup = renderToStaticMarkup(
      <CardSource transaction={bankTransaction} />,
    );
    expect(markup).toContain("Card used");
    expect(markup).toContain("Chase Sapphire Preferred");
    expect(markup).toContain("•••• 1234");
    expect(markup).toContain("/card-art/sapphire-preferred.png");
  });

  it("omits the card row for a manual transaction", () => {
    expect(
      renderToStaticMarkup(
        <CardSource transaction={{ ...bankTransaction, source: "manual" }} />,
      ),
    ).toBe("");
  });

  it("uses the server-resolved product for generic bank card names", () => {
    const markup = renderToStaticMarkup(
      <CardSource
        transaction={{
          ...bankTransaction,
          bankOriginal: {
            accountId: "card1",
            account: {
              id: "card1",
              name: "Ultimate Rewards®",
              mask: "1234",
              type: "credit",
              productName: "Chase Sapphire Preferred",
            },
          },
        }}
      />,
    );
    expect(markup).toContain("Chase Sapphire Preferred");
    expect(markup).toContain("/card-art/sapphire-preferred.png");
  });

});
