import { describe, expect, it } from "vitest";
import { demoState } from "../src/lib/demo";
import {
  transactionDisplay,
  transactionTitle,
} from "../src/lib/transaction-display";
import { createBudgetIndex, filterTransactions } from "../src/lib/budget-index";
import {
  applyOperation,
  balances,
  makeOperation,
  type Transaction,
} from "../shared/model";
const state = demoState();
const transfer: Transaction = {
  id: "transfer-display-test",
  kind: "transaction",
  version: 0,
  type: "transfer",
  payee: "Envelope transfer",
  amount: 13900,
  date: "2026-10-06",
  note: "",
  tags: [],
  allocations: [
    { envelopeId: "savings", amount: -13900 },
    { envelopeId: "groceries", amount: 13900 },
  ],
  pending: false,
  deleted: false,
  excluded: false,
  source: "manual",
  updatedAt: "2026-10-06T12:00:00Z",
};
describe("transaction amounts and transfer direction", () => {
  it("uses a renamed envelope throughout transaction labels and search", () => {
    const renamed = applyOperation(
      state,
      makeOperation(
        state,
        [{ ...(state.records.savings as any), name: "Rainy Day" }],
        "phone",
        "Rename envelope",
      ),
    );
    const expense: Transaction = {
      ...transfer,
      id: "expense-rename-test",
      type: "expense",
      payee: "Grocer",
      allocations: [{ envelopeId: "savings", amount: -13900 }],
    };
    const split: Transaction = {
      ...expense,
      id: "split-rename-test",
      amount: 20000,
      allocations: [
        { envelopeId: "savings", amount: -13900 },
        { envelopeId: "groceries", amount: -6100 },
      ],
    };
    const archive: Transaction = {
      ...transfer,
      id: "archive-rename-test",
      payee: "Archive Savings",
      note: "Settled balance before archiving",
    };
    const withTransactions = {
      ...renamed,
      records: {
        ...renamed.records,
        [expense.id]: expense,
        [split.id]: split,
        [archive.id]: archive,
      },
    };
    expect(transactionDisplay(withTransactions, expense).subtitle).toBe(
      "Rainy Day",
    );
    expect(transactionDisplay(withTransactions, split).subtitle).toBe(
      "Rainy Day, Groceries",
    );
    expect(
      transactionDisplay(withTransactions, {
        ...split,
        allocations: [
          ...split.allocations,
          { envelopeId: "dining", amount: -1000 },
        ],
      }).subtitle,
    ).toBe("3 envelopes");
    expect(transactionDisplay(withTransactions, transfer).subtitle).toBe(
      "Rainy Day → Groceries",
    );
    expect(transactionTitle(withTransactions, archive)).toBe(
      "Archive Rainy Day",
    );
    const index = createBudgetIndex(withTransactions);
    expect(
      filterTransactions(index, null, "all", "Rainy Day").map((t) => t.id),
    ).toEqual(expect.arrayContaining([expense.id, split.id, archive.id]));
  });
  it("shows a debit at the source and a green credit at the destination", () => {
    expect(transactionDisplay(state, transfer, "savings")).toEqual({
      amount: 13900,
      sign: "−",
      incoming: false,
      subtitle: "Transfer to Groceries",
    });
    expect(transactionDisplay(state, transfer, "groceries")).toEqual({
      amount: 13900,
      sign: "+",
      incoming: true,
      subtitle: "Transfer from Savings",
    });
    expect(transactionDisplay(state, transfer)).toEqual({
      amount: 13900,
      sign: "",
      incoming: false,
      subtitle: "Savings → Groceries",
    });
  });
  it("moves the same amount once and leaves the household total unchanged", () => {
    const before = balances(state);
    const after = balances(
      applyOperation(
        state,
        makeOperation(state, [transfer], "test", "Transfer"),
      ),
    );
    expect(after.savings).toBe(before.savings - 13900);
    expect(after.groceries).toBe(before.groceries + 13900);
    expect(Object.values(after).reduce((sum, value) => sum + value, 0)).toBe(
      Object.values(before).reduce((sum, value) => sum + value, 0),
    );
  });
  it("shows income, refunds, and positive adjustments as incoming with a plus", () => {
    for (const type of ["income", "refund", "adjustment"] as const) {
      const credit = {
        ...transfer,
        type,
        allocations: [{ envelopeId: "savings", amount: 13900 }],
      };
      expect(transactionDisplay(state, credit)).toMatchObject({
        incoming: true,
        sign: "+",
        amount: 13900,
      });
      expect(transactionDisplay(state, credit, "savings")).toMatchObject({
        incoming: true,
        sign: "+",
        amount: 13900,
      });
      expect(
        transactionDisplay(state, { ...credit, excluded: true }).incoming,
      ).toBe(false);
    }
  });
  it("shows only the selected envelope share of split income, including a savings shortfall", () => {
    const income = {
      ...transfer,
      type: "income" as const,
      amount: 10000,
      allocations: [
        { envelopeId: "savings", amount: -3900 },
        { envelopeId: "groceries", amount: 13900 },
      ],
    };
    expect(transactionDisplay(state, income, "savings")).toMatchObject({
      incoming: false,
      sign: "−",
      amount: 3900,
    });
    expect(transactionDisplay(state, income, "groceries")).toMatchObject({
      incoming: true,
      sign: "+",
      amount: 13900,
    });
  });
});
