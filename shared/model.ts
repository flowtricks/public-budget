import { z } from "zod";
const id = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (v) => !["__proto__", "constructor", "prototype"].includes(v),
    "Invalid identifier",
  );
const money = z.number().int().safe().min(-100_000_000_00).max(100_000_000_00);
const base = { id, version: z.number().int().nonnegative() };
export const EnvelopeSchema = z
  .object({
    ...base,
    kind: z.literal("envelope"),
    name: z.string().trim().min(1).max(80),
    target: money.nonnegative().nullable(),
    weeklyPaceEnabled: z.boolean().optional(),
    fiveWeekFundingEnabled: z.boolean().optional(),
    group: z.string().trim().max(80).optional(),
    opening: money,
    icon: z.string().max(80),
    color: z.string().max(30),
    order: z.number().finite(),
    archived: z.boolean(),
  })
  .strict();
export const TransactionSchema = z
  .object({
    ...base,
    kind: z.literal("transaction"),
    type: z.enum(["expense", "income", "transfer", "refund", "adjustment"]),
    payee: z.string().trim().min(1).max(150),
    amount: money.nonnegative(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v,
        "Invalid date",
      ),
    note: z.string().max(5000),
    tags: z.array(z.string().trim().min(1).max(60)).max(30),
    allocations: z
      .array(z.object({ envelopeId: id, amount: money }).strict())
      .max(200),
    pending: z.boolean(),
    deleted: z.boolean(),
    excluded: z.boolean(),
    source: z.enum(["manual", "import", "bank"]),
    sourceId: z.string().max(300).optional(),
    sourceAccount: z.string().max(300).optional(),
    merchantKey: z.string().max(200).optional(),
    bankOriginal: z.record(z.unknown()).optional(),
    needsReview: z.string().max(1000).optional(),
    importBatch: z.string().max(160).optional(),
    relatedTransactionId: id.optional(),
    firstSeenAt: z.string().optional(),
    firstSeenDate: z.string().optional(),
    updatedAt: z.string(),
  })
  .strict();
export const RuleSchema = z
  .object({
    ...base,
    kind: z.literal("rule"),
    merchant: z.string().max(200),
    envelopeId: id,
  })
  .strict();
export const SettingsSchema = z
  .object({
    ...base,
    kind: z.literal("settings"),
    name: z.string().max(80),
    fallbackId: z.string().max(240),
    currency: z.literal("USD"),
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
  })
  .strict();
export const RecordSchema = z.discriminatedUnion("kind", [
  EnvelopeSchema,
  TransactionSchema,
  RuleSchema,
  SettingsSchema,
]);
export type BudgetRecord = z.infer<typeof RecordSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type MerchantRule = z.infer<typeof RuleSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type State = {
  records: Record<string, BudgetRecord>;
  revision: number;
  generation: string;
};
export const OperationSchema = z
  .object({
    id,
    device: id,
    label: z.string().max(200),
    generation: z.string().max(100),
    createdAt: z.string(),
    patches: z
      .array(
        z
          .object({
            record: RecordSchema,
            expected: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(250),
    balances: z.record(money).optional(),
  })
  .strict();
export type Operation = z.infer<typeof OperationSchema>;
export const initialSettings: Settings = {
  id: "settings",
  kind: "settings",
  version: 0,
  name: "Household budget",
  fallbackId: "",
  currency: "USD",
  timezone: "America/Chicago",
};
export const emptyState = (generation = "local"): State => ({
  records: { settings: initialSettings },
  revision: 0,
  generation,
});
export const envelopes = (s: State) =>
  Object.values(s.records)
    .filter((r): r is Envelope => r.kind === "envelope")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
export const transactions = (s: State) =>
  Object.values(s.records)
    .filter((r): r is Transaction => r.kind === "transaction")
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.firstSeenAt || b.updatedAt).localeCompare(
          a.firstSeenAt || a.updatedAt,
        ) ||
        a.id.localeCompare(b.id),
    );
export const isLegacyDuplicateExclusion = (transaction: Transaction) =>
  transaction.excluded &&
  /^(Possible duplicate of |A matching bank transaction arrived )/.test(
    transaction.needsReview || "",
  );
export const settings = (s: State) =>
  (s.records.settings as Settings) || initialSettings;
export const merchantKey = (name: string) =>
  name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
export const ruleId = (name: string) => "rule:" + merchantKey(name);
export function eligibleExpenseEnvelope(s: State, t: Transaction) {
  if (
    t.type !== "expense" ||
    t.deleted ||
    t.excluded ||
    t.allocations.length !== 1 ||
    t.allocations[0].amount >= 0
  )
    return null;
  const id = t.allocations[0].envelopeId;
  const envelope = s.records[id];
  return envelope?.kind === "envelope" && !envelope.archived ? id : null;
}
export function popularEnvelope(
  counts: Map<string, number>,
  savedChoice: string | undefined,
  latestChoice: string | undefined,
) {
  let winner: string | undefined;
  let highest = 0;
  for (const [id, count] of counts) {
    if (count <= 0) continue;
    if (
      count > highest ||
      (count === highest && id === savedChoice) ||
      (count === highest && winner !== savedChoice && id === latestChoice)
    ) {
      winner = id;
      highest = count;
    }
  }
  return winner || savedChoice;
}
export function defaultEnvelope(s: State, payee: string) {
  const key = merchantKey(payee);
  const rule = s.records[ruleId(payee)];
  const saved =
    rule?.kind === "rule" &&
    s.records[rule.envelopeId]?.kind === "envelope" &&
    !(s.records[rule.envelopeId] as Envelope).archived
      ? rule.envelopeId
      : undefined;
  const counts = new Map<string, number>();
  let latest: string | undefined;
  for (const t of transactions(s)) {
    if (merchantKey(t.payee) !== key) continue;
    const id = eligibleExpenseEnvelope(s, t);
    if (!id) continue;
    latest ||= id;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const popular = popularEnvelope(counts, saved, latest);
  if (popular) return popular;
  const id = settings(s).fallbackId;
  return s.records[id]?.kind === "envelope" &&
    !(s.records[id] as Envelope).archived
    ? id
    : settings(s).fallbackId;
}
export function balances(s: State) {
  const result: Record<string, number> = {};
  for (const e of envelopes(s)) result[e.id] = e.opening;
  for (const t of Object.values(s.records)) {
    if (t.kind !== "transaction") continue;
    if (t.deleted || t.excluded) continue;
    for (const a of t.allocations)
      result[a.envelopeId] = (result[a.envelopeId] || 0) + a.amount;
  }
  return result;
}
export function envelopeRunningBalances(s: State, envelopeId: string) {
  const envelope = s.records[envelopeId];
  const result = new Map<string, number>();
  if (envelope?.kind !== "envelope") return result;
  let running = envelope.opening;
  for (const t of transactions(s).reverse()) {
    if (t.deleted || t.excluded) continue;
    const allocation = t.allocations.find((a) => a.envelopeId === envelopeId);
    if (!allocation) continue;
    running += allocation.amount;
    result.set(t.id, running);
  }
  return result;
}
export const cents = (value: string) => {
  const s = value.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(s))
    throw new Error("Enter an amount with up to two decimal places.");
  const sign = s.startsWith("-") ? -1 : 1;
  const [whole, fraction = ""] = s.replace("-", "").split(".");
  const v = sign * (Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(v) || Math.abs(v) > 100_000_000_00)
    throw new Error("Amount is too large.");
  return v;
};
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
export const moneyText = (v: number) => currencyFormatter.format(v / 100);
export const amountText = (v: number) => (v / 100).toFixed(2);
export const today = (timezone = "America/Chicago") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export class Conflict extends Error {
  constructor(
    message: string,
    public recordIds: string[] = [],
  ) {
    super(message);
    this.name = "Conflict";
  }
}
export function validateState(s: State) {
  const es = envelopes(s);
  const set = settings(s);
  for (const r of Object.values(s.records))
    if ((r.kind === "settings") !== (r.id === "settings"))
      throw new Error("Record settings identifier is reserved.");
  if (
    es.some((e) => !e.archived) &&
    (!set.fallbackId ||
      s.records[set.fallbackId]?.kind !== "envelope" ||
      (s.records[set.fallbackId] as Envelope).archived)
  )
    throw new Error("Choose an active default expense envelope.");
  for (const t of transactions(s)) {
    if (t.deleted || t.excluded) continue;
    const sum = t.allocations.reduce((a, b) => a + b.amount, 0);
    if (
      new Set(t.allocations.map((a) => a.envelopeId)).size !==
      t.allocations.length
    )
      throw new Error("Choose each envelope only once in a split.");
    for (const a of t.allocations)
      if (s.records[a.envelopeId]?.kind !== "envelope")
        throw new Error("An allocation refers to a missing envelope.");
    if (
      t.type === "expense" &&
      (sum !== -t.amount || t.allocations.some((a) => a.amount > 0))
    )
      throw new Error("Expense splits must equal the total spent.");
    if (
      t.type === "refund" &&
      (sum !== t.amount || t.allocations.some((a) => a.amount < 0))
    )
      throw new Error("Refund splits must equal the refund.");
    if (t.type === "income" && t.allocations.length && sum !== t.amount)
      throw new Error(
        "Assign all income, including any money moved from savings.",
      );
    if (t.type === "adjustment" && Math.abs(sum) !== t.amount)
      throw new Error("Adjustment allocations must equal the signed amount.");
    if (
      t.type === "transfer" &&
      (sum !== 0 ||
        t.allocations.reduce((n, a) => n + Math.max(0, a.amount), 0) !==
          t.amount)
    )
      throw new Error("Transfer amounts must balance.");
  }
  const bs = balances(s);
  for (const e of es)
    if (e.archived && bs[e.id] !== 0)
      throw new Error("An archived envelope must have a zero balance.");
}
export function applyOperation(
  state: State,
  input: Operation,
  check = true,
): State {
  const op = OperationSchema.parse(input);
  if (check && op.generation !== state.generation)
    throw new Conflict(
      "This budget was restored. Review your saved changes before syncing.",
    );
  const ids = op.patches.map((p) => p.record.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate records in a change.");
  if (check)
    for (const p of op.patches) {
      const old = state.records[p.record.id];
      if ((old?.version ?? null) !== p.expected)
        throw new Conflict(
          "This item changed on another device. Choose which version to keep.",
          [p.record.id],
        );
      if (old && old.kind !== p.record.kind)
        throw new Error("Record type cannot change.");
    }
  if (check && op.balances) {
    const current = balances(state);
    for (const [id, v] of Object.entries(op.balances))
      if (current[id] !== v)
        throw new Conflict(
          "An envelope balance changed. Review the transfer before continuing.",
          [id],
        );
  }
  const next: State = {
    ...state,
    records: { ...state.records },
    revision: state.revision + 1,
  };
  for (const p of op.patches)
    next.records[p.record.id] = {
      ...p.record,
      version: (state.records[p.record.id]?.version ?? 0) + 1,
    };
  // Historical changes must bring affected archived envelopes back into view.
  const bs = balances(next);
  for (const e of envelopes(next))
    if (e.archived && bs[e.id] !== 0) {
      const explicitlyArchived = op.patches.some(
        (p) =>
          p.record.id === e.id &&
          p.record.kind === "envelope" &&
          p.record.archived,
      );
      if (explicitlyArchived)
        throw new Error("Move this envelope balance to zero before archiving.");
      next.records[e.id] = { ...e, archived: false, version: e.version + 1 };
    }
  if (check)
    for (const p of op.patches) {
      if (
        p.record.kind !== "transaction" ||
        p.record.deleted ||
        p.record.excluded
      )
        continue;
      const old = state.records[p.record.id];
      for (const a of p.record.allocations) {
        const env = state.records[a.envelopeId];
        if (
          env?.kind === "envelope" &&
          env.archived &&
          !op.patches.some(
            (p) =>
              p.record.id === env.id &&
              p.record.kind === "envelope" &&
              !p.record.archived,
          ) &&
          !(
            old?.kind === "transaction" &&
            old.allocations.some((b) => b.envelopeId === a.envelopeId)
          )
        )
          throw new Conflict(
            "This envelope was archived. Choose an active envelope.",
            [a.envelopeId],
          );
      }
    }
  validateState(next);
  return next;
}
export function makeOperation(
  state: State,
  records: BudgetRecord[],
  device: string,
  label: string,
  guards?: Record<string, number>,
): Operation {
  return {
    id: crypto.randomUUID(),
    device,
    label,
    generation: state.generation,
    createdAt: new Date().toISOString(),
    patches: records.map((record) => ({
      record,
      expected: state.records[record.id]?.version ?? null,
    })),
    balances: guards,
  };
}
export function transactionPatches(
  state: State,
  tx: Transaction,
  learn = true,
): BudgetRecord[] {
  const result: BudgetRecord[] = [tx];
  if (
    learn &&
    tx.type === "expense" &&
    !tx.deleted &&
    !tx.excluded &&
    tx.allocations.length === 1
  ) {
    const old = state.records[tx.id];
    if (
      old?.kind === "transaction" &&
      old.payee === tx.payee &&
      old.allocations.length === 1 &&
      old.allocations[0].envelopeId === tx.allocations[0].envelopeId
    )
      return result;
    const key = merchantKey(tx.payee);
    result.push({
      id: ruleId(tx.payee),
      version: 0,
      kind: "rule",
      merchant: key,
      envelopeId: tx.allocations[0].envelopeId,
    });
  }
  return result;
}
