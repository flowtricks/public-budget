import { describe, expect, it } from "vitest";
import { cardDisplayKind, cardFromTransaction } from "../shared/card";
import type { Transaction } from "../shared/model";

const transaction = {
  source: "bank",
  bankOriginal: {
    accountId: "card1",
    account: {
      id: "card1",
      name: "Sapphire Preferred",
      mask: "1234",
      type: "credit",
    },
  },
} as Transaction;

describe("transaction card details", () => {
  it("shows a matched credit card on a bank transaction", () => {
    expect(cardFromTransaction(transaction)?.name).toBe("Sapphire Preferred");
  });

  it("does not attribute manual, file-imported, or checking transactions to a card", () => {
    expect(
      cardFromTransaction({ ...transaction, source: "manual" }),
    ).toBeUndefined();
    expect(
      cardFromTransaction({ ...transaction, source: "import" }),
    ).toBeUndefined();
    expect(
      cardFromTransaction({
        ...transaction,
        bankOriginal: {
          accountId: "card1",
          account: { id: "card1", name: "Checking", type: "depository" },
        },
      }),
    ).toBeUndefined();
  });

  it("does not display details for a different account", () => {
    expect(
      cardFromTransaction({
        ...transaction,
        bankOriginal: { ...transaction.bankOriginal, accountId: "card2" },
      }),
    ).toBeUndefined();
  });
});
