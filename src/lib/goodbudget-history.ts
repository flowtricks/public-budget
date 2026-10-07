import { parseTable } from "./csv";
import {
  cents,
  balances,
  validateState,
  RecordSchema,
  type State,
  type Envelope,
  type Transaction,
  type Settings,
} from "../../shared/model";

const columns = [
  "Date",
  "Envelope",
  "Account",
  "Name",
  "Notes",
  "Check #",
  "Amount",
  "Status",
  "Details",
];
const cleanName = (value: string) =>
  value
    .replace(/^DELETED: /, "")
    .replace(/\uFFFC/g, "")
    .trim();

// This adapter handles Goodbudget's signed history export, including paired
// envelope-transfer rows and the envelope|amount||envelope|amount split format.
export function importGoodbudgetHistory(
  csv: string,
  batch: string,
  preferences: Settings,
) {
  const { headers, rows } = parseTable(csv);
  if (headers.join("|") !== columns.join("|"))
    throw new Error("Unexpected Goodbudget history columns.");
  const state: State = { generation: batch, revision: 0, records: {} };
  const byName = new Map<string, Envelope>();
  const deletedNames = new Set<string>();
  const sourceBalances = new Map<string, number>();
  const covered = new Set<number>();
  let transferPairs = 0;
  let splitTransactions = 0;
  const mixedExpenses: number[] = [];
  function envelope(raw: string) {
    const name = cleanName(raw);
    if (!name) throw new Error("Missing envelope name.");
    if (raw.startsWith("DELETED: ")) deletedNames.add(name);
    let env = byName.get(name);
    if (!env) {
      env = {
        id: `${batch}:env:${byName.size}`,
        kind: "envelope",
        version: 1,
        name,
        target: null,
        opening: 0,
        icon: "envelope-simple",
        color: "green",
        order: byName.size,
        archived: false,
      };
      byName.set(name, env);
      state.records[env.id] = env;
    }
    return env;
  }
  function allocations(row: Record<string, string>) {
    const parts: [string, number][] = row.Details
      ? row.Details.split("||").map((part) => {
          const at = part.lastIndexOf("|");
          if (at < 1) throw new Error("Malformed split allocation.");
          return [part.slice(0, at), cents(part.slice(at + 1))];
        })
      : row.Envelope
        ? [[row.Envelope, cents(row.Amount)]]
        : [];
    const merged = new Map<string, number>();
    for (const [name, amount] of parts) {
      const env = envelope(name);
      merged.set(env.id, (merged.get(env.id) || 0) + amount);
      sourceBalances.set(env.id, (sourceBalances.get(env.id) || 0) + amount);
    }
    const result = [...merged].map(([envelopeId, amount]) => ({
      envelopeId,
      amount,
    }));
    if (result.reduce((sum, a) => sum + a.amount, 0) !== cents(row.Amount))
      throw new Error("Allocations do not equal the row amount.");
    return result;
  }
  for (let i = 0; i < rows.length; i++) {
    if (covered.has(i)) continue;
    const row = rows[i];
    try {
      if (row.Status) throw new Error("Unrecognized transaction status.");
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.Date);
      if (!match) throw new Error("Unexpected date format.");
      const date = `${match[3]}-${match[1]}-${match[2]}`;
      const signed = cents(row.Amount);
      let allocs = allocations(row);
      let type: Transaction["type"] =
        signed > 0 ? "income" : signed < 0 ? "expense" : "adjustment";
      const originalRows = [{ row: i + 2, values: row }];
      covered.add(i);
      if (!row.Account) {
        const next = rows[i + 1];
        if (
          !next ||
          next.Account ||
          next.Date !== row.Date ||
          next.Name !== row.Name ||
          next.Notes !== row.Notes ||
          cents(next.Amount) !== -signed ||
          !signed
        )
          throw new Error("Unpaired envelope transfer.");
        allocs = [...allocs, ...allocations(next)];
        if (
          allocs.length !== 2 ||
          allocs[0].envelopeId === allocs[1].envelopeId
        )
          throw new Error("Transfer must reference two distinct envelopes.");
        type = "transfer";
        covered.add(i + 1);
        originalRows.push({ row: i + 3, values: next });
        transferPairs++;
      } else if (signed < 0 && allocs.some((a) => a.amount > 0)) {
        // Preserve historical credits within a net withdrawal exactly.
        type = "adjustment";
        mixedExpenses.push(i + 2);
      } else if (
        signed > 0 &&
        /\brefund\b/i.test(row.Name) &&
        allocs.every((a) => a.amount >= 0)
      ) {
        type = "refund";
      }
      if (row.Details && allocs.length > 1) splitTransactions++;
      const tx: Transaction = {
        id: `${batch}:tx:${i}`,
        kind: "transaction",
        version: 1,
        type,
        payee: row.Name.trim(),
        amount: Math.abs(signed),
        date,
        note: row.Notes,
        tags: [],
        allocations: allocs,
        pending: false,
        deleted: false,
        excluded: false,
        source: "import",
        sourceId: `${batch}:row:${i + 2}`,
        sourceAccount: row.Account,
        importBatch: batch,
        bankOriginal: { format: "goodbudget-history", rows: originalRows },
        // CSV is newest-first, including its ordering within the same day.
        updatedAt: new Date(
          Date.parse(`${date}T23:59:59.999Z`) - i,
        ).toISOString(),
      };
      RecordSchema.parse(tx);
      state.records[tx.id] = tx;
    } catch (error) {
      throw new Error(`CSV row ${i + 2}: ${(error as Error).message}`);
    }
  }
  if (covered.size !== rows.length)
    throw new Error("Not every source row was imported.");
  const computed = balances(state);
  for (const env of byName.values()) {
    if (computed[env.id] !== sourceBalances.get(env.id))
      throw new Error(`Balance mismatch: ${env.name}`);
    env.archived = deletedNames.has(env.name) && computed[env.id] === 0;
    if (deletedNames.has(env.name)) env.group = "Historical";
  }
  // A recent distributed paycheck supplies a useful order, but not targets.
  const order =
    rows
      .find((row) => row.Details.split("||").length >= 10)
      ?.Details.split("||")
      .map((part) => cleanName(part.slice(0, part.lastIndexOf("|")))) || [];
  let orderIndex = 0;
  for (const name of [...new Set([...order, ...byName.keys()])])
    byName.get(name)!.order = orderIndex++;
  const fallback =
    byName.get("Spending") || [...byName.values()].find((e) => !e.archived)!;
  state.records.settings = {
    ...preferences,
    version: preferences.version + 1,
    fallbackId: fallback?.id || "",
  };
  for (const record of Object.values(state.records)) RecordSchema.parse(record);
  validateState(state);
  return {
    state,
    report: {
      sourceRows: rows.length,
      transactions: rows.length - transferPairs,
      transferPairs,
      splitTransactions,
      envelopes: byName.size,
      mixedExpenseRows: mixedExpenses,
      oldest: rows.at(-1)?.Date,
      newest: rows[0]?.Date,
      totalCents: Object.values(computed).reduce((sum, n) => sum + n, 0),
      envelopesSummary: [...byName.values()]
        .sort((a, b) => a.order - b.order)
        .map((e) => ({
          id: e.id,
          name: e.name,
          balanceCents: computed[e.id],
          target: e.target,
          archived: e.archived,
          formerlyDeleted: deletedNames.has(e.name),
        })),
    },
  };
}
