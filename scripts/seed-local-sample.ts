import { pbkdf2Sync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { demoState } from "../src/lib/demo";
import { exportCSV } from "../src/lib/csv";
import {
  balances,
  envelopes,
  makeOperation,
  settings,
  transactions,
  type State,
} from "../shared/model";

// Deliberately local-only: this helper never seeds a deployed household.
const origin = "http://127.0.0.1:8787";
let cookie = "",
  csrf = "";
async function call(path: string, body?: unknown) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            Origin: origin,
            "X-CSRF-Token": csrf,
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}
const config = (await (await call("/api/auth-config")).json()) as {
  salt: string;
  iterations: number;
};
const proof = pbkdf2Sync(
  readFileSync(".local-access-password", "utf8").trim(),
  config.salt,
  config.iterations,
  32,
  "sha256",
).toString("hex");
const login = await call("/api/login", {
  password: proof,
  device: "Local sample setup",
});
cookie = login.headers.get("set-cookie")!.split(";")[0];
csrf = ((await login.json()) as { csrf: string }).csrf;
try {
  const state = (await (await call("/api/state")).json()) as State;
  console.log(
    JSON.stringify({
      revision: state.revision,
      envelopes: envelopes(state).map((e) => ({ name: e.name, id: e.id })),
      transactions: transactions(state).length,
    }),
  );
  if (process.argv.includes("--apply")) {
    const existing = Object.values(state.records).filter(
      (r) => r.kind !== "settings",
    );
    if (existing.length)
      throw new Error("Main budget contains records. No data was changed.");
    const sample = demoState();
    const records = Object.values(sample.records)
      .filter((r) => r.kind !== "settings")
      .map((r) => ({ ...r, version: 0 }));
    records.push({
      ...settings(state),
      fallbackId: settings(sample).fallbackId,
    });
    const operation = makeOperation(
      state,
      records,
      "local-sample-setup",
      "Load sample envelopes and transactions",
    );
    const directory = `artifacts/backups/sample-setup-${Date.now()}`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(`${directory}/before.csv`, exportCSV(state), { mode: 0o600 });
    writeFileSync(
      `${directory}/operation.json`,
      JSON.stringify(operation, null, 2),
      { mode: 0o600 },
    );
    await call("/api/operations", operation);
    const after = (await (await call("/api/state")).json()) as State;
    const expectedBalances = balances(sample);
    const actualBalances = balances(after);
    if (
      envelopes(after).length !== envelopes(sample).length ||
      transactions(after).length !== transactions(sample).length ||
      Object.entries(expectedBalances).some(
        ([id, balance]) => actualBalances[id] !== balance,
      )
    ) {
      throw new Error(
        "Seed verification failed; inspect backup before retrying.",
      );
    }
    writeFileSync(`${directory}/after.csv`, exportCSV(after), { mode: 0o600 });
    console.log(
      JSON.stringify({
        seeded: true,
        envelopes: envelopes(after).length,
        transactions: transactions(after).length,
        totalCents: Object.values(balances(after)).reduce(
          (sum, n) => sum + n,
          0,
        ),
        backup: directory,
      }),
    );
  }
} finally {
  await call("/api/logout", {});
}
