import {
  emptyState,
  initialSettings,
  applyOperation,
  type State,
  type Operation,
  type BudgetRecord,
  Conflict,
  reconcilePotentialDuplicates,
} from "../shared/model";
import { notifyLive } from "./live";
export interface Env {
  LIVE: DurableObjectNamespace;
  BUDGET_API?: Fetcher;
  DB: D1Database;
  ASSETS: Fetcher;
  PASSWORD_HASH?: string;
  TOKEN_KEY?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  PLAID_REFRESH_ENABLED?: string;
  PLAID_WEBHOOK_URL?: string;
}
export async function readState(db: D1Database): Promise<State> {
  const result = await db.batch([
    db.prepare("SELECT * FROM meta WHERE id=1"),
    db.prepare("SELECT body FROM records"),
  ]);
  const m = result[0].results[0] as { revision: number; generation: string };
  const records: Record<string, BudgetRecord> = { settings: initialSettings };
  for (const r of result[1].results as { body: string }[]) {
    const item = JSON.parse(r.body) as BudgetRecord;
    records[item.id] = item;
  }
  return { records, revision: m.revision, generation: m.generation };
}
export async function commit(
  db: D1Database,
  op: Operation,
  live?: DurableObjectNamespace,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const receipt = await db
      .prepare("SELECT revision FROM operations WHERE id=?")
      .bind(op.id)
      .first<{ revision: number }>();
    if (receipt) return { revision: receipt.revision, duplicate: true };
    const before = await readState(db);
    op = reconcilePotentialDuplicates(before, op);
    const after = applyOperation(before, op);
    const changed = Object.values(after.records).filter(
      (r) => r !== before.records[r.id],
    );
    const assertion = crypto.randomUUID();
    const queries = [
      db
        .prepare(
          "INSERT INTO assertions(id,ok) VALUES (?,(SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM meta WHERE id=1))",
        )
        .bind(assertion, before.revision),
      db.prepare("UPDATE meta SET revision=? WHERE id=1").bind(after.revision),
    ];
    for (const r of changed)
      queries.push(
        db
          .prepare(
            "INSERT INTO records(id,kind,version,body) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body",
          )
          .bind(r.id, r.kind, r.version, JSON.stringify(r)),
      );
    queries.push(
      db
        .prepare("INSERT INTO operations VALUES (?,?,?,?,?)")
        .bind(
          op.id,
          after.revision,
          op.device,
          JSON.stringify(op),
          op.createdAt,
        ),
      db
        .prepare("INSERT INTO changes VALUES (?,?)")
        .bind(after.revision, JSON.stringify(changed)),
      db.prepare("DELETE FROM assertions WHERE id=?").bind(assertion),
    );
    try {
      await db.batch(queries);
      await notifyLive(live);
      return { revision: after.revision, duplicate: false };
    } catch (error) {
      const msg = String(error);
      if (msg.includes("CHECK constraint") || msg.includes("UNIQUE constraint"))
        continue;
      throw error;
    }
  }
  throw new Conflict("The budget is busy. Try syncing again.");
}
