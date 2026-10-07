import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { importGoodbudgetHistory } from "../src/lib/goodbudget-history";
import { emptyState, settings, type State } from "../shared/model";
const [source, directory] = process.argv.slice(2);
const local = process.argv.includes("--local");
if (!source || !directory)
  throw new Error("Supply a Goodbudget CSV and a new private output directory.");
if (!/^(?:artifacts|\.private)\//.test(directory))
  throw new Error("Write import files under artifacts/ or .private/ (both ignored by Git).");
// Read only the empty destination's generation and revision. Import data is never
// fetched from a pre-existing budget or copied into source control.
const output = execFileSync(
  "npx",
  [
    "wrangler", "d1", "execute", "DB", local ? "--local" : "--remote",
    "--config", local ? "wrangler.jsonc" : "wrangler.production.jsonc",
    "--command", "SELECT revision,generation,(SELECT COUNT(*) FROM records) AS record_count FROM meta WHERE id=1",
    "--json",
  ],
  { encoding: "utf8" },
);
const jsonStart = output.indexOf("[");
if (jsonStart < 0) throw new Error("Could not read Wrangler's JSON database response.");
const response = JSON.parse(output.slice(jsonStart)) as Array<{
  results?: Array<{ revision: number; generation: string; record_count: number }>;
}>;
const meta = response.flatMap((entry) => entry.results || [])[0];
if (!meta || typeof meta.generation !== "string")
  throw new Error("The destination database has not been initialized.");
if (meta.record_count !== 0 || meta.revision !== 0)
  throw new Error("Goodbudget history import requires a fresh, empty D1 database.");
const before: State = emptyState(meta.generation);
if (Object.keys(before.records).some((id) => id !== "settings"))
  throw new Error("Import requires an empty destination budget.");
const csv = readFileSync(source, "utf8");
const sha256 = createHash("sha256").update(csv).digest("hex");
const { state, report } = importGoodbudgetHistory(
  csv,
  `goodbudget:${sha256.slice(0, 24)}`,
  settings(before),
);
state.generation = randomUUID();
const quote = (text: string) => "'" + text.replace(/'/g, "''") + "'";
const guard = randomUUID();
const audit = {
  kind: "goodbudget_import",
  source,
  sha256,
  importedAt: new Date().toISOString(),
  ...report,
};
const sql = [
  `INSERT INTO assertions(id,ok) VALUES (${quote(guard)}, (SELECT CASE WHEN revision=${before.revision} AND generation=${quote(before.generation)} AND (SELECT COUNT(*) FROM records)=0 THEN 1 ELSE 0 END FROM meta WHERE id=1));`,
  ...Object.values(state.records).map(
    (r) =>
      `INSERT INTO records(id,kind,version,body) VALUES (${quote(r.id)},${quote(r.kind)},${r.version},${quote(JSON.stringify(r))})${r.id === "settings" ? " ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body" : ""};`,
  ),
  `UPDATE meta SET revision=0,generation=${quote(state.generation)} WHERE id=1;`,
  `INSERT INTO restored_audit(body) VALUES (${quote(JSON.stringify(audit))});`,
  `DELETE FROM assertions WHERE id=${quote(guard)};`,
];
mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const [name, content] of Object.entries({
  "import.sql": sql.join("\n") + "\n",
  "state.json": JSON.stringify(state),
  "report.json": JSON.stringify(audit, null, 2),
})) {
  writeFileSync(`${directory}/${name}`, content, { flag: "wx", mode: 0o600 });
}
console.log(
  JSON.stringify({
    directory,
    sourceRows: report.sourceRows,
    transactions: report.transactions,
    envelopes: report.envelopes,
    totalCents: report.totalCents,
    sqlBytes: Buffer.byteLength(sql.join("\n")),
  }),
);
