import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  emptyState,
  applyOperation,
  makeOperation,
  balances,
  transactions,
  type State,
  type Transaction,
} from "../shared/model";
import { encrypt } from "../worker/auth";
import { AUTOMATICALLY_ADDED_TAG } from "../shared/automatic-import";
import { cardFromTransaction } from "../shared/card";
let state: State;
let connection: any;
let updates: any;
let cursor: string | null = null;
let stateReads = 0;
vi.mock("../worker/store", () => ({
  readState: async () => {
    stateReads++;
    return state;
  },
  commit: async (_db: any, op: any) => {
    state = applyOperation(state, op);
    return { revision: state.revision };
  },
}));
const raw = (patch: any = {}) => ({
  transaction_id: "pending1",
  amount: 10,
  merchant_name: "Target",
  date: "2025-04-11",
  account_id: "card1",
  pending: true,
  personal_finance_category: { detailed: "GENERAL_MERCHANDISE_SUPERSTORES" },
  ...patch,
});
const database = {
  prepare: (sql: string) => ({
    bind: (...args: any[]) => ({
      first: async () => connection,
      run: async () => {
        if (sql.startsWith("UPDATE connections SET cursor")) {
          cursor = args[0];
          if (sql.includes("backfill_day=NULL")) connection.backfill_day = null;
        }
        return { meta: { changes: 1 } };
      },
    }),
    all: async () => ({ results: [connection] }),
  }),
};
const env: any = {
  DB: database,
  TOKEN_KEY: "ab".repeat(32),
  PLAID_CLIENT_ID: "test",
  PLAID_SECRET: "test",
  PLAID_ENV: "sandbox",
};
beforeEach(async () => {
  stateReads = 0;
  state = emptyState("test");
  state = applyOperation(
    state,
    makeOperation(
      state,
      [
        {
          id: "food",
          kind: "envelope",
          version: 0,
          name: "Food",
          target: 10000,
          opening: 10000,
          icon: "Wallet",
          color: "green",
          order: 0,
          archived: false,
        },
        { ...(state.records.settings as any), fallbackId: "food" },
      ],
      "test",
      "Setup",
    ),
  );
  connection = {
    id: "item1",
    name: "Example bank",
    provider: "plaid",
    enabled: 1,
    connected_at: "2025-04-11T00:00:00.000Z",
    connected_on: "2025-04-10",
    selected_accounts: '["card1"]',
    token: await encrypt("test-token", env.TOKEN_KEY),
    cursor: null,
  };
  cursor = null;
  updates = {
    added: [],
    modified: [],
    removed: [],
    next_cursor: "cursor1",
    has_more: false,
  };
  vi.stubGlobal(
    "fetch",
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/accounts/get")
            ? {
                accounts: [
                  {
                    account_id: "card1",
                    name: "Sapphire Preferred",
                    official_name: "Chase Sapphire Preferred",
                    mask: "1234",
                    type: "credit",
                    subtype: "credit card",
                  },
                ],
              }
            : updates,
        ),
      ),
  );
});
afterEach(() => vi.unstubAllGlobals());
async function sync() {
  const { syncAll } = await import("../worker/plaid");
  await syncAll(env);
}
describe("bank reconciliation", () => {
  it("does not load the full budget when Plaid has no transaction changes", async () => {
    await sync();
    expect(stateReads).toBe(0);
    expect(cursor).toBe("cursor1");
  });
  it("ignores other accounts and transactions made before connection", async () => {
    updates.added = [
      raw({ transaction_id: "business", account_id: "business-card" }),
      raw({ transaction_id: "old", authorized_date: "2025-04-09" }),
      raw({ transaction_id: "new" }),
    ];
    await sync();
    expect(transactions(state).map((t) => t.sourceId)).toEqual(["item1:new"]);
    expect(balances(state).food).toBe(9000);
  });
  it("does not import from a paused connection", async () => {
    connection.enabled = 0;
    updates.added = [raw()];
    await sync();
    expect(transactions(state)).toHaveLength(0);
  });
  it("backfills the connection day's bank charge once and keeps its posted replacement", async () => {
    connection.connected_at = "2025-04-12T10:30:00.000Z";
    connection.connected_on = "2025-04-11";
    updates.added = [
      raw({
        transaction_id: "pending-gas",
        merchant_name: "Sample Fuel",
        authorized_date: "2025-04-12",
        authorized_datetime: "2025-04-12T00:00:00Z",
        date: "2025-04-12",
      }),
    ];
    await sync();
    expect(transactions(state)).toHaveLength(0);

    connection.backfill_day = "2025-04-12";
    await sync();
    expect(transactions(state)).toHaveLength(1);
    expect(transactions(state)[0].bankOriginal?.backfilledOn).toBe("2025-04-12");
    expect(connection.backfill_day).toBeNull();

    updates.added = [
      raw({
        transaction_id: "posted-gas",
        pending_transaction_id: "pending-gas",
        merchant_name: "Sample Fuel",
        authorized_date: "2025-04-12",
        authorized_datetime: "2025-04-12T00:00:00Z",
        date: "2025-04-14",
        pending: false,
      }),
    ];
    updates.removed = [{ transaction_id: "pending-gas" }];
    await sync();
    expect(transactions(state)).toHaveLength(1);
    expect(transactions(state)[0].sourceId).toBe("item1:posted-gas");
    expect(transactions(state)[0].bankOriginal?.backfilledOn).toBe("2025-04-12");
    expect(transactions(state)[0].deleted).toBe(false);
  });
  it("assigns a new card charge to the payee's last chosen envelope", async () => {
    const groceries = {
      ...state.records.food,
      id: "groceries",
      version: 0,
      name: "Groceries",
      opening: 0,
      order: 1,
    };
    const prior: Transaction = {
      id: "prior-target",
      kind: "transaction",
      version: 0,
      type: "expense",
      payee: "Target",
      amount: 500,
      date: "2025-04-11",
      allocations: [{ envelopeId: "groceries", amount: -500 }],
      note: "",
      tags: [],
      pending: false,
      deleted: false,
      excluded: false,
      source: "manual",
      updatedAt: "2025-04-11T12:00:00.000Z",
    };
    state = applyOperation(
      state,
      makeOperation(state, [groceries, prior], "phone", "Prior purchase"),
    );
    updates.added = [raw({ date: "2025-04-12" })];
    await sync();
    const imported = transactions(state).find((t) => t.source === "bank");
    expect(imported?.allocations).toEqual([
      { envelopeId: "groceries", amount: -1000 },
    ]);
    expect(imported?.tags).toContain(AUTOMATICALLY_ADDED_TAG);
    expect(cardFromTransaction(imported)).toMatchObject({
      name: "Sapphire Preferred",
      mask: "1234",
      type: "credit",
    });
  });
  it("a pending-to-posted replacement changes the balance only once", async () => {
    updates.added = [raw()];
    await sync();
    expect(balances(state).food).toBe(9000);
    updates = {
      ...updates,
      added: [
        raw({
          transaction_id: "posted1",
          pending_transaction_id: "pending1",
          amount: 12,
          pending: false,
        }),
      ],
      removed: [{ transaction_id: "pending1" }],
    };
    await sync();
    expect(transactions(state)).toHaveLength(1);
    expect(balances(state).food).toBe(8800);
    expect(transactions(state)[0].pending).toBe(false);
    expect(transactions(state)[0].tags).toContain(AUTOMATICALLY_ADDED_TAG);
    expect(cursor).toBe("cursor1");
  });
  it("a removed pending charge reverses its deduction", async () => {
    updates.added = [raw()];
    await sync();
    updates = {
      ...updates,
      added: [],
      removed: [{ transaction_id: "pending1" }],
    };
    await sync();
    expect(balances(state).food).toBe(10000);
    expect(transactions(state)[0].deleted).toBe(true);
  });
  it("credit card payments and account transfers do not alter budget money", async () => {
    updates.added = [
      raw({
        transaction_id: "payment",
        personal_finance_category: {
          detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        },
      }),
      raw({
        transaction_id: "transfer",
        personal_finance_category: { detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" },
        amount: -25,
      }),
    ];
    await sync();
    expect(balances(state).food).toBe(10000);
    expect(transactions(state).every((t) => t.excluded)).toBe(true);
  });
  it("imported paychecks wait for manual distribution", async () => {
    updates.added = [
      raw({
        amount: -2000,
        merchant_name: "Employer",
        personal_finance_category: { detailed: "INCOME_WAGES" },
      }),
    ];
    await sync();
    expect(transactions(state)[0].type).toBe("income");
    expect(transactions(state)[0].allocations).toEqual([]);
    expect(balances(state).food).toBe(10000);
  });
  it("keeps an edited bank amount when the posted amount changes", async () => {
    updates.added = [raw()];
    await sync();
    const tx = transactions(state)[0];
    state = applyOperation(
      state,
      makeOperation(
        state,
        [
          {
            ...tx,
            note: "Keep my note",
            bankOriginal: { ...tx.bankOriginal, edited: true },
          },
        ],
        "phone",
        "Edit",
      ),
    );
    updates = {
      ...updates,
      added: [],
      modified: [raw({ amount: 12, pending: false })],
    };
    await sync();
    expect(transactions(state)[0].amount).toBe(1000);
    expect(transactions(state)[0].needsReview).toContain("changed");
    expect(transactions(state)[0].note).toBe("Keep my note");
    expect(transactions(state)[0].tags).not.toContain(AUTOMATICALLY_ADDED_TAG);
  });
  it("a possible manual duplicate is retained but excluded for review", async () => {
    const t: Transaction = {
      id: "manual",
      kind: "transaction",
      version: 0,
      type: "expense",
      payee: "Target",
      amount: 1000,
      date: "2025-04-11",
      allocations: [{ envelopeId: "food", amount: -1000 }],
      note: "",
      tags: [],
      pending: false,
      deleted: false,
      excluded: false,
      source: "manual",
      updatedAt: new Date().toISOString(),
    };
    state = applyOperation(state, makeOperation(state, [t], "phone", "Manual"));
    updates.added = [raw()];
    await sync();
    expect(balances(state).food).toBe(9000);
    expect(
      transactions(state).find((t) => t.source === "bank")?.needsReview,
    ).toContain("duplicate");
  });
  it("bank refreshes cannot resurrect a deleted imported transaction", async () => {
    updates.added = [raw()];
    await sync();
    const t = transactions(state)[0];
    state = applyOperation(
      state,
      makeOperation(state, [{ ...t, deleted: true }], "phone", "Delete"),
    );
    await sync();
    expect(transactions(state)[0].deleted).toBe(true);
    expect(balances(state).food).toBe(10000);
  });
});

it("a refund brings the original archived envelope back into view", async () => {
  updates.added = [raw({ amount: 100, pending: false })];
  await sync();
  state = applyOperation(
    state,
    makeOperation(
      state,
      [
        {
          id: "other",
          kind: "envelope",
          version: 0,
          name: "Other",
          target: null,
          opening: 0,
          icon: "Wallet",
          color: "green",
          order: 1,
          archived: false,
        },
        { ...(state.records.settings as any), fallbackId: "other" },
        { ...(state.records.food as any), archived: true },
      ],
      "phone",
      "Archive food",
    ),
  );
  updates = {
    ...updates,
    added: [raw({ transaction_id: "refund", amount: -20, pending: false })],
  };
  await sync();
  expect((state.records.food as any).archived).toBe(false);
  expect(balances(state).food).toBe(2000);
  expect(balances(state).other).toBe(0);
});
