import { describe, it, expect } from "vitest";
import {
  emptyState,
  applyOperation,
  makeOperation,
  balances,
  envelopeRunningBalances,
  cents,
  transactionPatches,
  defaultEnvelope,
  EnvelopeSchema,
  type State,
  type Envelope,
  type Transaction,
} from "../shared/model";
import {
  exportCSV,
  parseRestore,
  goodbudgetPreview,
  guessMapping,
} from "../src/lib/csv";
import { AUTOMATICALLY_ADDED_TAG } from "../shared/automatic-import";
const env = (
  id: string,
  opening = 0,
  target: number | null = 10000,
): Envelope => ({
  id,
  kind: "envelope",
  version: 0,
  name: id,
  target,
  opening,
  icon: "Wallet",
  color: "blue",
  order: 0,
  archived: false,
});
const tx = (patch: Partial<Transaction> = {}): Transaction => ({
  id: crypto.randomUUID(),
  kind: "transaction",
  version: 0,
  type: "expense",
  payee: "Target",
  amount: 857,
  date: "2026-10-06",
  note: "",
  tags: [],
  allocations: [
    { envelopeId: "groceries", amount: -532 },
    { envelopeId: "household", amount: -325 },
  ],
  pending: false,
  deleted: false,
  excluded: false,
  source: "manual",
  updatedAt: new Date().toISOString(),
  ...patch,
});
it("keeps weekly pace opt-outs while older envelopes stay enabled by default", () => {
  const original = env("groceries");
  expect(EnvelopeSchema.parse(original).weeklyPaceEnabled).toBeUndefined();
  expect(
    EnvelopeSchema.parse({ ...original, weeklyPaceEnabled: false })
      .weeklyPaceEnabled,
  ).toBe(false);
  const state = start();
  const saved = applyOperation(
    state,
    makeOperation(
      state,
      [{ ...(state.records.groceries as Envelope), weeklyPaceEnabled: false }],
      "phone1",
      "Exclude from weekly pace",
    ),
  );
  expect((saved.records.groceries as Envelope).weeklyPaceEnabled).toBe(false);
});
function start() {
  let s = emptyState("test");
  return applyOperation(
    s,
    makeOperation(
      s,
      [
        env("groceries", 10000),
        env("household", 5000),
        env("savings", 100000),
        { ...(s.records.settings as any), fallbackId: "household" },
      ],
      "phone1",
      "Setup",
    ),
  );
}
const edit = (s: State, records: any[]) =>
  applyOperation(s, makeOperation(s, records, "phone1", "Edit"));
describe("budget ledger", () => {
  it("uses exact cents and refuses fractions of a cent", () => {
    expect(cents("$1,234.56")).toBe(123456);
    expect(cents("0.29")).toBe(29);
    expect(() => cents("1.001")).toThrow();
  });
  it("splits in exact dollars and reverses edits/deletions", () => {
    let s = start();
    const t = tx();
    s = edit(s, [t]);
    expect(balances(s).groceries).toBe(9468);
    expect(balances(s).household).toBe(4675);
    s = edit(s, [
      {
        ...t,
        amount: 1000,
        allocations: [{ envelopeId: "groceries", amount: -1000 }],
      },
    ]);
    expect(balances(s).household).toBe(5000);
    s = edit(s, [{ ...s.records[t.id], deleted: true }]);
    expect(balances(s).groceries).toBe(10000);
  });
  it("rejects unbalanced and duplicate splits", () => {
    const s = start();
    expect(() => edit(s, [tx({ amount: 858 })])).toThrow(/splits/);
    expect(() =>
      edit(s, [
        tx({
          allocations: [
            { envelopeId: "groceries", amount: -532 },
            { envelopeId: "groceries", amount: -325 },
          ],
        }),
      ]),
    ).toThrow(/once/);
  });
  it("income plus a savings draw creates only earned money", () => {
    const s = start();
    const before = Object.values(balances(s)).reduce((a, b) => a + b, 0);
    const next = edit(s, [
      tx({
        type: "income",
        amount: 1000,
        allocations: [
          { envelopeId: "groceries", amount: 2000 },
          { envelopeId: "savings", amount: -1000 },
        ],
      }),
    ]);
    expect(
      Object.values(balances(next)).reduce((a, b) => a + b, 0) - before,
    ).toBe(1000);
  });
  it("unallocated paycheck does not inflate envelopes", () => {
    const s = start();
    expect(
      balances(edit(s, [tx({ type: "income", allocations: [] })])),
    ).toEqual(balances(s));
  });
  it("transfers conserve money and reject self-duplicates", () => {
    const s = start();
    const next = edit(s, [
      tx({
        type: "transfer",
        amount: 1000,
        allocations: [
          { envelopeId: "groceries", amount: -1000 },
          { envelopeId: "savings", amount: 1000 },
        ],
      }),
    ]);
    expect(Object.values(balances(next)).reduce((a, b) => a + b, 0)).toBe(
      115000,
    );
  });
  it("archive requires zero; historical refund changes unarchive", () => {
    let s = start();
    expect(() => edit(s, [{ ...s.records.groceries, archived: true }])).toThrow(
      /zero/,
    );
    const t = tx({
      amount: 10000,
      allocations: [{ envelopeId: "groceries", amount: -10000 }],
    });
    s = edit(s, [t]);
    s = edit(s, [{ ...s.records.groceries, archived: true }]);
    s = edit(s, [
      {
        ...t,
        amount: 9900,
        allocations: [{ envelopeId: "groceries", amount: -9900 }],
      },
    ]);
    expect((s.records.groceries as Envelope).archived).toBe(false);
    expect(balances(s).groceries).toBe(100);
  });
  it("does not allow new purchases in archived envelopes", () => {
    let s = start();
    s = edit(s, [env("retired", 0)]);
    s = edit(s, [{ ...s.records.retired, archived: true }]);
    expect(() =>
      edit(s, [
        tx({
          amount: 100,
          allocations: [{ envelopeId: "retired", amount: -100 }],
        }),
      ]),
    ).toThrow(/archived/);
  });
  it("rejects a stale version instead of overwriting another phone", () => {
    let s = start();
    const op = makeOperation(
      s,
      [{ ...s.records.groceries, name: "Food" } as Envelope],
      "phone2",
      "Rename",
    );
    s = edit(s, [{ ...s.records.groceries, name: "Groceries!" }]);
    expect(() => applyOperation(s, op)).toThrow(/another device/);
  });
  it("balance guards catch a new purchase while archiving", () => {
    let s = start();
    const op = makeOperation(
      s,
      [{ ...s.records.groceries, name: "Food" } as Envelope],
      "phone2",
      "Guard",
      { groceries: 10000 },
    );
    s = edit(s, [tx()]);
    expect(() => applyOperation(s, op)).toThrow(/balance changed/);
  });
  it("remembered merchant uses last single envelope; split keeps that rule", () => {
    let s = start();
    const a = tx({ allocations: [{ envelopeId: "groceries", amount: -857 }] });
    s = edit(s, transactionPatches(s, a));
    expect(defaultEnvelope(s, "TARGET")).toBe("groceries");
    s = edit(s, transactionPatches(s, tx()));
    expect(defaultEnvelope(s, "Target")).toBe("groceries");
    expect(defaultEnvelope(s, "New merchant")).toBe("household");
  });
  it("uses the latest eligible expense even when it did not create a merchant rule", () => {
    let s = start();
    const older = tx({
      payee: "Wal Mart",
      date: "2026-10-01",
      allocations: [{ envelopeId: "groceries", amount: -857 }],
    });
    s = edit(s, transactionPatches(s, older));
    const latest = tx({
      payee: "wal mart",
      date: "2026-10-06",
      source: "bank",
      allocations: [{ envelopeId: "savings", amount: -857 }],
    });
    s = edit(s, [latest]);
    expect(defaultEnvelope(s, "WAL MART")).toBe("savings");
    s = edit(s, [
      tx({
        payee: "Wal Mart",
        date: "2026-10-07",
        excluded: true,
        allocations: [{ envelopeId: "household", amount: -857 }],
      }),
    ]);
    expect(defaultEnvelope(s, "Wal Mart")).toBe("savings");
  });
  it("does not let an unapproved bank import replace a chosen envelope", () => {
    let s = start();
    const chosen = tx({
      payee: "Target",
      date: "2026-10-01",
      allocations: [{ envelopeId: "groceries", amount: -857 }],
    });
    s = edit(s, [chosen]);
    s = edit(s, [
      tx({
        payee: "Target",
        date: "2026-10-06",
        source: "bank",
        tags: [AUTOMATICALLY_ADDED_TAG],
        bankOriginal: { payee: "Target" },
        allocations: [{ envelopeId: "household", amount: -857 }],
      }),
    ]);
    expect(defaultEnvelope(s, "Target")).toBe("groceries");
  });
  it("note edits do not overwrite a newer merchant choice", () => {
    let s = start();
    const a = tx({
      date: "2026-10-01",
      allocations: [{ envelopeId: "groceries", amount: -857 }],
    });
    s = edit(s, transactionPatches(s, a));
    s = edit(
      s,
      transactionPatches(
        s,
        tx({
          date: "2026-10-06",
          allocations: [{ envelopeId: "household", amount: -857 }],
        }),
      ),
    );
    s = edit(s, transactionPatches(s, { ...a, note: "Old purchase" }));
    expect(defaultEnvelope(s, "Target")).toBe("household");
  });
  it("pending reduces balances, final amount replaces it once, payment is excluded", () => {
    let s = start();
    const t = tx({ pending: true });
    s = edit(s, [t]);
    s = edit(s, [{ ...t, pending: false }]);
    expect(balances(s).groceries).toBe(9468);
    s = edit(s, [
      tx({ excluded: true, payee: "Credit card payment", allocations: [] }),
    ]);
    expect(balances(s).groceries).toBe(9468);
  });
  it("rejects operations from a restored generation", () => {
    const s = start();
    const op = makeOperation(s, [env("x")], "phone1", "New");
    expect(() => applyOperation({ ...s, generation: "new" }, op)).toThrow(
      /restored/,
    );
  });
});
describe("CSV safety and recovery", () => {
  it("round trips every record, quotes, tags and deleted history", () => {
    let s = start();
    s = edit(s, [
      tx({
        payee: '=HYPERLINK("bad")',
        note: 'A comma, a quote " and\na new line',
        tags: ["Girl’s Birthday"],
        deleted: true,
      }),
    ]);
    const op = makeOperation(s, [env("trip")], "phone", "Offline envelope");
    const csv = exportCSV(s, [op]);
    const restored = parseRestore(csv);
    expect(restored.state).toEqual(s);
    expect(restored.queue).toEqual([JSON.parse(JSON.stringify(op))]);
    expect(csv).toContain("'=HYPERLINK");
  });
  it("flags ambiguous Goodbudget fills instead of importing expense", () => {
    const result = goodbudgetPreview(
      [
        {
          Date: "10/6/2026",
          Payee: "Fill",
          Amount: "100",
          Envelope: "Food",
          Type: "Fill",
        },
      ],
      guessMapping(["Date", "Payee", "Amount", "Envelope", "Type"]),
      "batch",
    );
    expect(result.errors).toHaveLength(1);
    expect(result.records).toHaveLength(0);
  });
  it("validates imported dates", () => {
    const result = goodbudgetPreview(
      [{ Date: "2026-02-30", Payee: "Shop", Amount: "1", Envelope: "Food" }],
      guessMapping(["Date", "Payee", "Amount", "Envelope"]),
      "batch",
    );
    expect(result.errors).toHaveLength(1);
  });
});

it("flags an offline purchase if its matching bank transaction arrived first", async () => {
  const { reconcilePotentialDuplicates } = await import("../shared/model");
  let s = start();
  const bank = tx({ source: "bank", sourceId: "bank123" });
  s = edit(s, [bank]);
  const local = tx();
  const op = reconcilePotentialDuplicates(
    s,
    makeOperation(s, [local], "phone", "Offline purchase"),
  );
  const next = applyOperation(s, op);
  expect((next.records[local.id] as Transaction).excluded).toBe(true);
  expect(balances(next)).toEqual(balances(s));
});

describe("envelope activity", () => {
  it("shows each envelope's split, pending purchase, and transfer in chronological order", () => {
    let s = start();
    const purchase = tx({ id: "purchase", date: "2026-10-02", pending: true });
    const income = tx({
      id: "income",
      date: "2026-10-01",
      type: "income",
      amount: 5000,
      allocations: [
        { envelopeId: "groceries", amount: 2000 },
        { envelopeId: "household", amount: 3000 },
      ],
    });
    const transfer = tx({
      id: "transfer",
      date: "2026-10-03",
      type: "transfer",
      amount: 1000,
      allocations: [
        { envelopeId: "groceries", amount: -1000 },
        { envelopeId: "household", amount: 1000 },
      ],
    });
    s = edit(s, [
      transfer,
      purchase,
      income,
      tx({ id: "excluded", excluded: true }),
      tx({ id: "deleted", deleted: true }),
    ]);
    expect([...envelopeRunningBalances(s, "groceries")]).toEqual([
      ["income", 12000],
      ["purchase", 11468],
      ["transfer", 10468],
    ]);
    expect([...envelopeRunningBalances(s, "household")]).toEqual([
      ["income", 8000],
      ["purchase", 7675],
      ["transfer", 8675],
    ]);
    expect(envelopeRunningBalances(s, "groceries").get("transfer")).toBe(
      balances(s).groceries,
    );
    s = edit(s, [{ ...s.records.purchase, deleted: true }]);
    expect(envelopeRunningBalances(s, "groceries").get("transfer")).toBe(11000);
  });
  it("preserves optional envelope groups in a full CSV restore", () => {
    let s = start();
    s = edit(s, [{ ...s.records.groceries, group: "Weekly" }]);
    const restored = parseRestore(exportCSV(s));
    expect(restored.state.records.groceries).toMatchObject({ group: "Weekly" });
    expect(restored.state.records.household).not.toHaveProperty("group");
  });
});
