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
import { cardFromTransaction } from "../shared/card";
let state: State;
let connection: any;
let updates: any;
let cursor: string | null = null;
let commits = 0;
let stateReads = 0;
vi.mock("../worker/store", () => ({
  readState: async () => {
    stateReads++;
    return state;
  },
  commit: async (_db: any, op: any) => {
    commits++;
    state = applyOperation(state, op);
    return { revision: state.revision };
  },
}));
const raw = (patch: any = {}) => ({
  transaction_id: "pending1",
  amount: 10,
  merchant_name: "Target",
  date: "2026-10-06",
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
  commits = 0;
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
    name: "Chase test",
    provider: "plaid",
    enabled: 1,
    connected_at: "2026-10-06T00:00:00.000Z",
    connected_on: "2026-10-05",
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
    expect(commits).toBe(0);
    expect(cursor).toBe("cursor1");
  });
  it("imports a page of transactions in bounded batches", async () => {
    updates.added = Array.from({ length: 60 }, (_, index) =>
      raw({
        transaction_id: `charge-${index}`,
        merchant_name: `Store ${index}`,
      }),
    );
    await sync();
    expect(transactions(state)).toHaveLength(60);
    expect(commits).toBe(2);
    expect(cursor).toBe("cursor1");
  });
  it("ignores other accounts and transactions made before connection", async () => {
    updates.added = [
      raw({ transaction_id: "business", account_id: "business-card" }),
      raw({ transaction_id: "old", authorized_date: "2026-10-04" }),
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
  it("backfills the connection day's Chase charge once and keeps its posted replacement", async () => {
    connection.connected_at = "2026-10-07T04:17:37.000Z";
    connection.connected_on = "2026-10-06";
    updates.added = [
      raw({
        transaction_id: "pending-gas",
        merchant_name: "ExxonMobil",
        authorized_date: "2026-10-07",
        authorized_datetime: "2026-10-07T00:00:00Z",
        date: "2026-10-07",
      }),
    ];
    await sync();
    expect(transactions(state)).toHaveLength(0);

    connection.backfill_day = "2026-10-07";
    await sync();
    expect(transactions(state)).toHaveLength(1);
    expect(transactions(state)[0].bankOriginal?.backfilledOn).toBe(
      "2026-10-07",
    );
    expect(connection.backfill_day).toBeNull();

    updates.added = [
      raw({
        transaction_id: "posted-gas",
        pending_transaction_id: "pending-gas",
        merchant_name: "ExxonMobil",
        authorized_date: "2026-10-07",
        authorized_datetime: "2026-10-07T00:00:00Z",
        date: "2026-10-09",
        pending: false,
      }),
    ];
    updates.removed = [{ transaction_id: "pending-gas" }];
    await sync();
    expect(transactions(state)).toHaveLength(1);
    expect(transactions(state)[0].sourceId).toBe("item1:posted-gas");
    expect(transactions(state)[0].bankOriginal?.backfilledOn).toBe(
      "2026-10-07",
    );
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
      date: "2026-10-06",
      allocations: [{ envelopeId: "groceries", amount: -500 }],
      note: "",
      tags: [],
      pending: false,
      deleted: false,
      excluded: false,
      source: "manual",
      updatedAt: "2026-10-06T12:00:00.000Z",
    };
    state = applyOperation(
      state,
      makeOperation(state, [groceries, prior], "phone", "Prior purchase"),
    );
    updates.added = [raw({ date: "2026-10-07" })];
    await sync();
    const imported = transactions(state).find((t) => t.source === "bank");
    expect(imported?.allocations).toEqual([
      { envelopeId: "groceries", amount: -1000 },
    ]);
    expect(imported?.tags).toEqual([]);
    expect(cardFromTransaction(imported)).toMatchObject({
      name: "Sapphire Preferred",
      mask: "1234",
      type: "credit",
    });
  });
  it("uses the saved merchant choice to break a usage tie", async () => {
    const savings = {
      ...state.records.food,
      id: "savings",
      version: 0,
      name: "Savings",
      opening: 0,
      order: 1,
    };
    const prior: Transaction = {
      id: "recent-mcdonalds",
      kind: "transaction",
      version: 0,
      type: "expense",
      payee: "McDonald's",
      amount: 500,
      date: "2026-10-07",
      allocations: [{ envelopeId: "savings", amount: -500 }],
      note: "",
      tags: [],
      pending: false,
      deleted: false,
      excluded: false,
      source: "import",
      updatedAt: "2026-10-07T12:00:00.000Z",
    };
    state = applyOperation(
      state,
      makeOperation(
        state,
        [
          savings,
          {
            ...prior,
            id: "older-mcdonalds",
            source: "manual",
            date: "2026-10-01",
            allocations: [{ envelopeId: "food", amount: -500 }],
          },
          prior,
          {
            id: "rule:mcdonald's",
            kind: "rule",
            version: 0,
            merchant: "mcdonald's",
            envelopeId: "food",
          },
        ],
        "phone",
        "Prior choice",
      ),
    );
    updates.added = [
      raw({ transaction_id: "new-mcdonalds", merchant_name: "McDonald's" }),
    ];
    await sync();
    expect(
      transactions(state).find((t) => t.sourceId === "item1:new-mcdonalds")
        ?.allocations,
    ).toEqual([{ envelopeId: "food", amount: -1000 }]);
  });
  it("imports into the most common envelope across manual and imported purchases", async () => {
    const savings = {
      ...state.records.food,
      id: "savings",
      version: 0,
      name: "Savings",
      opening: 0,
      order: 1,
    };
    const purchase: Transaction = {
      id: "older-mcdonalds",
      kind: "transaction",
      version: 0,
      type: "expense",
      payee: "McDonald's",
      amount: 500,
      date: "2026-09-01",
      allocations: [{ envelopeId: "food", amount: -500 }],
      note: "",
      tags: [],
      pending: false,
      deleted: false,
      excluded: false,
      source: "manual",
      updatedAt: "2026-09-01T12:00:00.000Z",
    };
    state = applyOperation(
      state,
      makeOperation(
        state,
        [
          savings,
          purchase,
          {
            ...purchase,
            id: "second-mcdonalds",
            source: "import",
            date: "2026-09-02",
          },
          {
            ...purchase,
            id: "latest-mcdonalds",
            source: "bank",
            date: "2026-10-07",
            allocations: [{ envelopeId: "savings", amount: -500 }],
          },
          {
            id: "rule:mcdonald's",
            kind: "rule",
            version: 0,
            merchant: "mcdonald's",
            envelopeId: "savings",
          },
        ],
        "phone",
        "Past purchases",
      ),
    );
    updates.added = [
      raw({ transaction_id: "new-mcdonalds", merchant_name: "McDonald's" }),
    ];
    await sync();
    expect(
      transactions(state).find((t) => t.sourceId === "item1:new-mcdonalds")
        ?.allocations,
    ).toEqual([{ envelopeId: "food", amount: -1000 }]);
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
    expect(transactions(state)[0].tags).toEqual([]);
    expect(cursor).toBe("cursor1");
  });
  it("keeps a pending purchase in its original list position when it posts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
      updates.added = [raw()];
      await sync();
      const first = transactions(state)[0];
      expect(first.firstSeenAt).toBe("2026-10-07T12:00:00.000Z");
      vi.setSystemTime(new Date("2026-10-07T12:00:30Z"));
      state = applyOperation(
        state,
        makeOperation(
          state,
          [
            {
              ...first,
              note: "Keep my note",
              updatedAt: new Date().toISOString(),
              bankOriginal: { ...first.bankOriginal, edited: true },
            },
          ],
          "phone",
          "Edit pending purchase",
        ),
      );

      vi.setSystemTime(new Date("2026-10-07T12:01:00Z"));
      updates.added = [
        raw({ transaction_id: "pending2", merchant_name: "Second store" }),
      ];
      await sync();
      expect(transactions(state).map((tx) => tx.id)).toEqual([
        "bank:item1:pending2",
        first.id,
      ]);

      vi.setSystemTime(new Date("2026-10-07T12:02:00Z"));
      updates.added = [
        raw({
          transaction_id: "posted1",
          pending_transaction_id: "pending1",
          pending: false,
          amount: 12,
          date: "2026-10-08",
        }),
      ];
      updates.removed = [{ transaction_id: "pending1" }];
      await sync();
      expect(transactions(state).map((tx) => tx.id)).toEqual([
        "bank:item1:pending2",
        first.id,
      ]);
      expect(transactions(state)[1].firstSeenAt).toBe(first.firstSeenAt);
      expect(transactions(state)[1].note).toBe("Keep my note");
      expect(transactions(state)[1].date).toBe(first.date);
      expect(transactions(state)[1].bankOriginal?.date).toBe("2026-10-08");
      expect(transactions(state)[1].amount).toBe(1200);
    } finally {
      vi.useRealTimers();
    }
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
  it("a canceled pending charge reverses its deduction after an edit", async () => {
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
            note: "Waiting for tip",
            bankOriginal: { ...tx.bankOriginal, edited: true },
          },
        ],
        "phone",
        "Edit pending purchase",
      ),
    );
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
  it("excludes a card payment Plaid labels as a loan disbursement", async () => {
    updates.added = [
      raw({
        transaction_id: "thank-you",
        amount: -150,
        merchant_name: "Card Payment Online",
        pending: false,
        personal_finance_category: {
          detailed: "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT",
        },
      }),
    ];
    await sync();
    const payment = transactions(state)[0];
    expect(payment.excluded).toBe(true);
    expect(payment.allocations).toEqual([]);
    expect(balances(state).food).toBe(10000);
  });
  it("reclassifies an unedited card payment when Plaid corrects its category", async () => {
    updates.added = [raw({ transaction_id: "card-payment", amount: -50 })];
    await sync();
    expect(transactions(state)[0].excluded).toBe(false);
    updates = {
      ...updates,
      added: [],
      modified: [
        raw({
          transaction_id: "card-payment",
          amount: -50,
          personal_finance_category: {
            detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          },
        }),
      ],
    };
    await sync();
    expect(transactions(state)[0].excluded).toBe(true);
    expect(transactions(state)[0].allocations).toEqual([]);
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
  for (const linked of [true, false]) {
    it(`keeps an assigned pending income envelope when it posts ${linked ? "with" : "without"} a Plaid pending ID`, async () => {
      updates.added = [
        raw({
          amount: -20,
          merchant_name: "Employer",
          personal_finance_category: { detailed: "INCOME_WAGES" },
        }),
      ];
      await sync();
      const pending = transactions(state)[0];
      state = applyOperation(
        state,
        makeOperation(
          state,
          [
            {
              ...pending,
              allocations: [{ envelopeId: "food", amount: 2000 }],
              bankOriginal: { ...pending.bankOriginal, edited: true },
            },
          ],
          "phone",
          "Assign pending income",
        ),
      );
      updates = {
        ...updates,
        added: [
          raw({
            transaction_id: "posted-income",
            ...(linked ? { pending_transaction_id: "pending1" } : {}),
            amount: -20,
            merchant_name: linked ? "Employer" : "Employer Payroll",
            date: "2026-10-07",
            pending: false,
            personal_finance_category: { detailed: "INCOME_WAGES" },
          }),
        ],
        removed: [{ transaction_id: "pending1" }],
      };
      await sync();
      expect(transactions(state)).toHaveLength(1);
      expect(transactions(state)[0].id).toBe(pending.id);
      expect(transactions(state)[0].sourceId).toBe("item1:posted-income");
      expect(transactions(state)[0].pending).toBe(false);
      expect(transactions(state)[0].allocations).toEqual([
        { envelopeId: "food", amount: 2000 },
      ]);
      expect(balances(state).food).toBe(12000);
    });
  }
  it("does not guess which of two identical pending deposits a posting replaces", async () => {
    updates.added = [
      raw({ amount: -20, merchant_name: "Employer" }),
      raw({
        transaction_id: "pending2",
        amount: -20,
        merchant_name: "Employer",
      }),
    ];
    await sync();
    updates = {
      ...updates,
      added: [
        raw({
          transaction_id: "posted-income",
          amount: -20,
          merchant_name: "Employer",
          date: "2026-10-07",
          pending: false,
        }),
      ],
      removed: [{ transaction_id: "pending1" }, { transaction_id: "pending2" }],
    };
    await sync();
    expect(transactions(state)).toHaveLength(3);
    expect(transactions(state).filter((tx) => !tx.deleted)).toHaveLength(1);
  });
  it("does not guess which of two identical postings replaced a pending deposit", async () => {
    updates.added = [raw({ amount: -20, merchant_name: "Employer" })];
    await sync();
    updates = {
      ...updates,
      added: [
        raw({
          transaction_id: "posted1",
          amount: -20,
          merchant_name: "Employer Payroll",
          pending: false,
        }),
        raw({
          transaction_id: "posted2",
          amount: -20,
          merchant_name: "Employer Payroll",
          pending: false,
        }),
      ],
      removed: [{ transaction_id: "pending1" }],
    };
    await sync();
    expect(transactions(state)).toHaveLength(3);
    expect(transactions(state).filter((tx) => !tx.deleted)).toHaveLength(2);
  });
  it("updates a posted tip while preserving an edited note", async () => {
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
    expect(transactions(state)[0].amount).toBe(1200);
    expect(transactions(state)[0].allocations).toEqual([
      { envelopeId: "food", amount: -1200 },
    ]);
    expect(balances(state).food).toBe(8800);
    expect(transactions(state)[0].needsReview).toBeUndefined();
    expect(transactions(state)[0].note).toBe("Keep my note");
    expect(transactions(state)[0].tags).toEqual([]);
  });
  it("updates an edited pending purchase when Plaid replaces it with a posted amount", async () => {
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
        "Edit pending purchase",
      ),
    );
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
    expect(transactions(state)[0].sourceId).toBe("item1:posted1");
    expect(transactions(state)[0].note).toBe("Keep my note");
    expect(transactions(state)[0].amount).toBe(1200);
    expect(balances(state).food).toBe(8800);
  });
  it("preserves an amount explicitly changed by the user", async () => {
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
            amount: 1100,
            allocations: [{ envelopeId: "food", amount: -1100 }],
            bankOriginal: { ...tx.bankOriginal, edited: true },
          },
        ],
        "phone",
        "Edit amount",
      ),
    );
    updates = {
      ...updates,
      added: [],
      modified: [raw({ amount: 12, pending: false })],
    };
    await sync();
    expect(transactions(state)[0].amount).toBe(1100);
    expect(transactions(state)[0].allocations).toEqual([
      { envelopeId: "food", amount: -1100 },
    ]);
    expect(balances(state).food).toBe(8900);
  });
  it("counts a bank purchase even when a matching manual purchase exists", async () => {
    const t: Transaction = {
      id: "manual",
      kind: "transaction",
      version: 0,
      type: "expense",
      payee: "Target",
      amount: 1000,
      date: "2026-10-06",
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
    expect(balances(state).food).toBe(8000);
    expect(transactions(state).find((t) => t.source === "bank")?.excluded).toBe(
      false,
    );
  });
  it("includes an older duplicate exclusion when the bank updates it", async () => {
    updates.added = [raw()];
    await sync();
    const imported = transactions(state)[0];
    state = applyOperation(
      state,
      makeOperation(
        state,
        [
          {
            ...imported,
            excluded: true,
            needsReview:
              "Possible duplicate of Target on 2026-10-06. Excluded until you review.",
          },
        ],
        "phone",
        "Old duplicate exclusion",
      ),
    );
    expect(balances(state).food).toBe(10000);
    updates = { ...updates, added: [], modified: [raw({ pending: false })] };
    await sync();
    expect(transactions(state)[0].excluded).toBe(false);
    expect(transactions(state)[0].needsReview).toBeUndefined();
    expect(balances(state).food).toBe(9000);
  });
  it("rescales an unedited split when the final bank amount changes", async () => {
    updates.added = [raw()];
    await sync();
    const imported = transactions(state)[0];
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
            target: 10000,
            opening: 10000,
            icon: "Wallet",
            color: "blue",
            order: 1,
            archived: false,
          },
          {
            ...imported,
            allocations: [
              { envelopeId: "food", amount: -600 },
              { envelopeId: "other", amount: -400 },
            ],
          },
        ],
        "phone",
        "Split bank purchase",
      ),
    );
    updates = {
      ...updates,
      added: [],
      modified: [raw({ amount: 12, pending: false })],
    };
    await sync();
    expect(transactions(state)[0].amount).toBe(1200);
    expect(transactions(state)[0].allocations).toEqual([
      { envelopeId: "food", amount: -720 },
      { envelopeId: "other", amount: -480 },
    ]);
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
