import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { demoState } from "../src/lib/demo";
import { exportCSV } from "../src/lib/csv";
import {
  balances,
  makeOperation,
  applyOperation,
  type Envelope,
} from "../shared/model";
it("owner restore preserves money, queued edits and audit; refuses a nonempty database", () => {
  const dir = mkdtempSync(join(tmpdir(), "public-budget-restore-test-"));
  const db = new DatabaseSync(":memory:");
  try {
    const state = demoState();
    const op = makeOperation(
      state,
      [{ ...state.records.groceries, name: "Restored groceries" } as Envelope],
      "offline-phone",
      "Rename",
    );
    const expected = applyOperation(state, op);
    const csv = join(dir, "backup.csv");
    const sql = join(dir, "restored.sql");
    writeFileSync(
      csv,
      exportCSV(
        state,
        [op],
        [{ label: "Historical audit entry", revision: 1 }],
      ),
    );
    execFileSync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/restore.ts",
      csv,
      sql,
    ]);
    db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
    db.exec(readFileSync("migrations/0002_restore_audit.sql", "utf8"));
    db.exec(readFileSync(sql, "utf8"));
    const records = Object.fromEntries(
      (db.prepare("SELECT body FROM records").all() as { body: string }[]).map(
        (r) => {
          const v = JSON.parse(r.body);
          return [v.id, v];
        },
      ),
    );
    expect(records).toEqual(expected.records);
    expect(balances({ ...expected, records })).toEqual(balances(expected));
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM restored_audit").get()?.count,
    ).toBe(2);
    expect(
      db.prepare("SELECT generation FROM meta").get()?.generation,
    ).not.toBe(state.generation);
    expect(() => db.exec(readFileSync(sql, "utf8"))).toThrow(
      /CHECK constraint/,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
