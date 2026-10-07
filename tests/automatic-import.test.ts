import { describe, expect, it } from "vitest";
import {
  AUTOMATICALLY_ADDED_TAG,
  isUnapprovedAutomatic,
  unapprovedDeletionPatches,
  withoutAutomaticTag,
} from "../shared/automatic-import";
import { demoState } from "../src/lib/demo";
import { createBudgetIndex, filterTransactions } from "../src/lib/budget-index";
import type { Transaction } from "../shared/model";
import { applyOperation, makeOperation } from "../shared/model";

const base: Transaction = {
  id: "bank-item",
  kind: "transaction",
  version: 1,
  type: "expense",
  payee: "Groceries",
  amount: 1200,
  date: "2025-04-12",
  note: "",
  tags: [AUTOMATICALLY_ADDED_TAG],
  allocations: [{ envelopeId: "groceries", amount: -1200 }],
  pending: false,
  deleted: false,
  excluded: false,
  source: "bank",
  bankOriginal: {},
  updatedAt: "2025-04-12T12:00:00Z",
};

describe("automatic bank import approval", () => {
  it("removes the reserved tag when a user saves a transaction", () => {
    expect(
      withoutAutomaticTag(["Food", " automatically added ", "Trip"]),
    ).toEqual(["Food", "Trip"]);
    expect(isUnapprovedAutomatic(base)).toBe(true);
    expect(isUnapprovedAutomatic({ ...base, tags: [] })).toBe(false);
    expect(
      isUnapprovedAutomatic({ ...base, bankOriginal: { edited: true } }),
    ).toBe(false);
  });

  it("limits the bulk filter to unapproved, visible bank imports", () => {
    const state = demoState();
    state.records[base.id] = base;
    state.records.approved = {
      ...base,
      id: "approved",
      tags: ["Food"],
      bankOriginal: { edited: true },
    };
    state.records.deletedImport = {
      ...base,
      id: "deletedImport",
      deleted: true,
    };
    state.records.manual = { ...base, id: "manual", source: "manual" };
    const index = createBudgetIndex(state);
    expect(
      filterTransactions(index, null, "automatic", "").map((t) => t.id),
    ).toEqual([base.id]);
    const patches = unapprovedDeletionPatches(state, "2025-04-12T13:00:00Z");
    expect(patches.map((transaction) => transaction.id)).toEqual([base.id]);
    const deleted = applyOperation(
      state,
      makeOperation(state, patches, "phone", "Delete unapproved imports"),
    );
    expect((deleted.records[base.id] as Transaction).deleted).toBe(true);
    expect((deleted.records.approved as Transaction).deleted).toBe(false);
    expect((deleted.records.manual as Transaction).deleted).toBe(false);
  });
});
