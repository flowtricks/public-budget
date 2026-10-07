import { readFileSync, writeFileSync } from "node:fs";
import { parseRestore } from "../src/lib/csv";
import { applyOperation, balances, validateState } from "../shared/model";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: npm run restore:prepare -- backup.csv fresh-database.sql",
  );
const restored = parseRestore(readFileSync(input, "utf8"));
let state = restored.state;
for (const op of restored.queue) state = applyOperation(state, op, false);
validateState(state);
const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const generation = crypto.randomUUID();
const guard = crypto.randomUUID();
const statements = [
  "-- Restore only into a NEW, migrated D1 database. Never execute against the live budget.",
  // D1 file imports execute statements incrementally. The first statement must fail
  // before any writes if a database already holds records.
  `INSERT INTO assertions(id,ok) VALUES (${quote(guard)},(SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM records));`,
  `UPDATE meta SET revision=0,generation=${quote(generation)} WHERE id=1;`,
  ...Object.values(state.records).map(
    (r) =>
      `INSERT INTO records(id,kind,version,body) VALUES (${quote(r.id)},${quote(r.kind)},${r.version},${quote(JSON.stringify(r))});`,
  ),
  ...[
    ...restored.audit,
    ...restored.queue.map((op) => ({ ...op, recoveredOffline: true })),
  ].map(
    (item) =>
      `INSERT INTO restored_audit(body) VALUES (${quote(JSON.stringify(item))});`,
  ),
  `DELETE FROM assertions WHERE id=${quote(guard)};`,
  "SELECT COUNT(*) AS restored_records FROM records;",
];
writeFileSync(output, statements.join("\n") + "\n", {
  flag: "wx",
  mode: 0o600,
});
const expected = {
  records: Object.keys(state.records).length,
  envelopeBalances: balances(state),
  generation,
};
writeFileSync(
  output + ".expected.json",
  JSON.stringify(expected, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  `Validated ${expected.records} records. Wrote restore SQL and an expected-balances file. No database was changed. Verify the fresh database before switching the Worker binding.`,
);
