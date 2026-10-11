import { describe, expect, it } from "vitest";
import { demoState } from "../src/lib/demo";
import {
  createBudgetIndex,
  filterTransactions,
  indexedRunningBalances,
} from "../src/lib/budget-index";
import {
  balances,
  envelopeRunningBalances,
  type Transaction,
} from "../shared/model";

function fixture() {
  const state = demoState();
  const transaction: Transaction = {
    id: "old-purchase",
    kind: "transaction",
    version: 1,
    type: "expense",
    payee: "Historic merchant",
    amount: 12345,
    date: "2016-01-04",
    note: "School supplies",
    tags: ["Birthday"],
    allocations: [{ envelopeId: "groceries", amount: -12345 }],
    pending: false,
    excluded: false,
    deleted: false,
    source: "manual",
    updatedAt: "2016-01-04T00:00:00Z",
  };
  state.records[transaction.id] = transaction;
  state.records.deleted = { ...transaction, id: "deleted", deleted: true };
  state.records.excluded = { ...transaction, id: "excluded", excluded: true };
  state.records.unallocated = {
    ...transaction,
    id: "unallocated",
    type: "income",
    allocations: [],
  };
  state.records.pending = { ...transaction, id: "pending", pending: true };
  return state;
}

describe("cached budget history", () => {
  it("preserves balances and transaction ordering for every envelope", () => {
    const state = fixture();
    const index = createBudgetIndex(state);
    expect(index.bs).toEqual(balances(state));
    for (const envelope of index.es)
      expect(indexedRunningBalances(index, envelope.id)).toEqual(
        envelopeRunningBalances(state, envelope.id),
      );
    expect(
      filterTransactions(index, "groceries", "all", "").map((t) => t.id),
    ).toEqual(
      index.everyTransaction
        .filter(
          (t) =>
            !t.deleted &&
            !t.excluded &&
            t.allocations.some((a) => a.envelopeId === "groceries"),
        )
        .map((t) => t.id),
    );
  });
  it("searches old transactions by merchant, note, tag, envelope, and amount", () => {
    const index = createBudgetIndex(fixture());
    filterTransactions(index, null, "all", "");
    expect(index.searchText.size).toBe(0);
    for (const term of [
      "historic MERCHANT",
      "school supplies",
      "birthday",
      "groceries",
      "$123.45",
    ])
      expect(
        filterTransactions(index, null, "all", term).some(
          (t) => t.id === "old-purchase",
        ),
      ).toBe(true);
    expect(
      filterTransactions(index, "savings", "all", "Historic merchant"),
    ).toHaveLength(0);
    expect(
      filterTransactions(index, null, "all", "nonexistent merchant"),
    ).toHaveLength(0);
  });
  it("keeps deleted, excluded, pending, and unallocated filters distinct", () => {
    const index = createBudgetIndex(fixture());
    expect(
      filterTransactions(index, null, "deleted", "Historic merchant").map(
        (t) => t.id,
      ),
    ).toEqual(["deleted"]);
    expect(
      filterTransactions(
        index,
        null,
        "including-excluded",
        "Historic merchant",
      ).some((t) => t.id === "excluded"),
    ).toBe(true);
    expect(
      filterTransactions(
        index,
        "groceries",
        "including-excluded",
        "Historic merchant",
      ).some((t) => t.id === "excluded"),
    ).toBe(false);
    expect(
      filterTransactions(index, null, "pending", "Historic merchant").map(
        (t) => t.id,
      ),
    ).toEqual(["pending"]);
    expect(
      filterTransactions(index, null, "unallocated", "Historic merchant")
        .map((t) => t.id)
        .sort(),
    ).toEqual(["unallocated"]);
  });
  it("matches any checked tag while retaining the text and envelope filters", () => {
    const state = fixture();
    const base = state.records["old-purchase"] as Transaction;
    state.records.food = { ...base, id: "food", tags: ["Food"] };
    state.records.vacation = {
      ...base,
      id: "vacation",
      tags: ["Vacation"],
    };
    state.records.both = {
      ...base,
      id: "both",
      tags: ["Food", "Vacation"],
    };
    const index = createBudgetIndex(state);
    const ids = (
      query: string,
      tags: string[],
      envelope: string | null = null,
    ) =>
      filterTransactions(index, envelope, "all", query, tags)
        .map((transaction) => transaction.id)
        .sort();

    expect(ids("", ["fOoD", "vacation"])).toEqual(["both", "food", "vacation"]);
    expect(ids("historic merchant", ["food"])).toEqual(["both", "food"]);
    expect(ids("school supplies", ["food"], "savings")).toEqual([]);
    expect(ids("", ["foo"])).toEqual([]);
  });
  it("refreshes search and balances when transaction data changes", () => {
    const state = fixture();
    const original = createBudgetIndex(state);
    expect(
      filterTransactions(original, null, "all", "Historic merchant").length,
    ).toBeGreaterThan(0);
    const next = {
      ...state,
      revision: state.revision + 1,
      records: {
        ...state.records,
        "old-purchase": {
          ...(state.records["old-purchase"] as Transaction),
          payee: "Renamed merchant",
          amount: 500,
          allocations: [{ envelopeId: "groceries", amount: -500 }],
        },
      },
    };
    const updated = createBudgetIndex(next);
    expect(
      filterTransactions(updated, null, "all", "Renamed merchant").map(
        (t) => t.id,
      ),
    ).toEqual(["old-purchase"]);
    expect(updated.bs.groceries - original.bs.groceries).toBe(11845);
  });
});
