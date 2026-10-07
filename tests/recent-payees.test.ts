import { expect, it } from "vitest";
import { emptyState, type Transaction } from "../shared/model";
import { recentTransactionPayees } from "../src/lib/recent-payees";

const income = (
  id: string,
  payee: string,
  date: string,
  patch: Partial<Transaction> = {},
): Transaction => ({
  id,
  kind: "transaction",
  version: 0,
  type: "income",
  payee,
  amount: 100,
  date,
  note: "",
  tags: [],
  allocations: [],
  pending: false,
  deleted: false,
  excluded: false,
  source: "manual",
  updatedAt: `${date}T12:00:00Z`,
  ...patch,
});

it("shows active payers in latest transaction order, ignoring deleted entries", () => {
  const state = emptyState();
  for (const transaction of [
    income("deleted", "DEPOSIT", "2026-10-06", { deleted: true }),
    income("excluded", "OTHER DEPOSIT", "2026-10-05", { excluded: true }),
    income("recent", "Employer A", "2026-10-04"),
    income("older-spelling", "employer a", "2026-09-28"),
    income("old", "Employer", "2026-10-02"),
    income("expense", "Store", "2026-10-07", { type: "expense" }),
  ])
    state.records[transaction.id] = transaction;

  expect(recentTransactionPayees(state, "income")).toEqual([
    "Employer A",
    "Employer",
  ]);
  expect(recentTransactionPayees(state, "expense")).toEqual(["Store"]);
});
