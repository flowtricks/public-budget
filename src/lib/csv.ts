import Papa from "papaparse";
import {
  RecordSchema,
  OperationSchema,
  validateState,
  emptyState,
  type State,
  type BudgetRecord,
  type Operation,
  type Transaction,
  type Envelope,
  cents,
} from "../../shared/model";
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);
export function exportCSV(
  state: State,
  queue: Operation[] = [],
  audit: unknown[] = [],
) {
  const rows: any[] = [
    {
      record_type: "manifest",
      record_id: "manifest",
      name: "Public Budget export",
      payload_json: JSON.stringify({
        schema_version: 1,
        generation: state.generation,
        revision: state.revision,
        exported_at: new Date().toISOString(),
        local_recovery: queue.length > 0,
        snapshot: "acknowledged",
        records: Object.keys(state.records).length,
      }),
    },
  ];
  for (const r of Object.values(state.records))
    rows.push({
      record_type: r.kind,
      record_id: r.id,
      name: safe("name" in r ? r.name : "payee" in r ? r.payee : ""),
      date: "date" in r ? r.date : "",
      amount_minor: "amount" in r ? r.amount : "",
      notes: safe("note" in r ? r.note : ""),
      payload_json: JSON.stringify(r),
    });
  for (const op of queue)
    rows.push({
      record_type: "queued_operation",
      record_id: op.id,
      name: safe(op.label),
      payload_json: JSON.stringify(op),
    });
  for (const op of audit)
    rows.push({ record_type: "audit", payload_json: JSON.stringify(op) });
  return Papa.unparse(rows, {
    columns: [
      "record_type",
      "record_id",
      "name",
      "date",
      "amount_minor",
      "notes",
      "payload_json",
    ],
    quotes: true,
    newline: "\r\n",
  });
}
export function parseRestore(csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) throw new Error("The CSV contains malformed rows.");
  const state = emptyState();
  let manifest: any;
  const queue: Operation[] = [];
  const audit: unknown[] = [];
  for (const row of parsed.data) {
    if (row.record_type === "manifest") manifest = JSON.parse(row.payload_json);
    else if (row.record_type === "queued_operation")
      queue.push(OperationSchema.parse(JSON.parse(row.payload_json)));
    else if (row.record_type === "audit")
      audit.push(JSON.parse(row.payload_json));
    else {
      const r = RecordSchema.parse(JSON.parse(row.payload_json));
      state.records[r.id] = r;
    }
  }
  if (!manifest || manifest.schema_version !== 1)
    throw new Error("This is not a supported Public Budget export.");
  if (Object.keys(state.records).length !== manifest.records)
    throw new Error("The export record count does not match.");
  state.generation = manifest.generation;
  state.revision = manifest.revision;
  validateState(state);
  return { state, queue, audit };
}
export type ImportMapping = {
  date: string;
  payee: string;
  amount: string;
  envelope: string;
  note: string;
  type: string;
  tags: string;
};
export function parseTable(csv: string) {
  const p = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  if (p.errors.length)
    throw new Error(
      "The CSV has malformed rows. Check its quoting and column count.",
    );
  return { headers: p.meta.fields || [], rows: p.data };
}
export function guessMapping(headers: string[]): ImportMapping {
  const find = (words: string[]) =>
    headers.find((h) => words.includes(h.toLowerCase())) || "";
  return {
    date: find(["date", "transaction date"]),
    payee: find(["name", "payee", "description"]),
    amount: find(["amount"]),
    envelope: find(["envelope", "category"]),
    note: find(["notes", "note", "memo"]),
    type: find(["type", "transaction type"]),
    tags: find(["tags"]),
  };
}
export function goodbudgetPreview(
  rows: Record<string, string>[],
  map: ImportMapping,
  batch: string,
) {
  const records: BudgetRecord[] = [];
  const errors: string[] = [];
  const names = new Map<string, string>();
  let order = 0;
  rows.forEach((row, i) => {
    try {
      let date = row[map.date] || "";
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
        const [m, d, y] = date.split("/");
        date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
      const payee = (row[map.payee] || "").trim();
      const value = cents(row[map.amount] || "");
      const rawType = (row[map.type] || "").toLowerCase();
      if (/transfer|fill|split/.test(rawType))
        throw new Error(
          "This transfer/fill/split needs explicit mapping; it cannot safely be treated as an expense.",
        );
      const type: Transaction["type"] = /income|credit|deposit/.test(rawType)
        ? "income"
        : /refund/.test(rawType)
          ? "refund"
          : "expense";
      const envName = (row[map.envelope] || "").trim();
      if (!envName && type !== "income") throw new Error("Missing envelope.");
      let envId = names.get(envName);
      if (envName && !envId) {
        envId = `${batch}:env:${order++}`;
        names.set(envName, envId);
        records.push({
          id: envId,
          version: 0,
          kind: "envelope",
          name: envName,
          target: null,
          opening: 0,
          icon: "Wallet",
          color: "blue",
          order: order,
          archived: false,
        });
      }
      const amount = Math.abs(value);
      const tx: Transaction = {
        id: `${batch}:tx:${i}`,
        kind: "transaction",
        version: 0,
        type,
        payee,
        amount,
        date,
        note: row[map.note] || "",
        tags: (row[map.tags] || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        allocations: envId
          ? [
              {
                envelopeId: envId,
                amount: type === "expense" ? -amount : amount,
              },
            ]
          : [],
        pending: false,
        deleted: false,
        excluded: false,
        source: "import",
        importBatch: batch,
        bankOriginal: row,
        updatedAt: new Date().toISOString(),
      };
      RecordSchema.parse(tx);
      records.push(tx);
    } catch (e) {
      errors.push(
        `Row ${i + 2}: ${e instanceof Error ? e.message : "Invalid data"}`,
      );
    }
  });
  return { records, errors };
}
export function download(
  text: string,
  name: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
