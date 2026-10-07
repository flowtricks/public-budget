import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const state = mkdtempSync(join(tmpdir(), "public-budget-test-"));
const cli = join(process.cwd(), "node_modules/wrangler/bin/wrangler.js");
let server;
try {
  execFileSync(
    process.execPath,
    [
      cli,
      "d1",
      "migrations",
      "apply",
      "budget",
      "--local",
      "--persist-to",
      state,
    ],
    { stdio: "pipe" },
  );
  server = spawn(
    process.execPath,
    [
      cli,
      "dev",
      "--local",
      "--port",
      "8788",
      "--persist-to",
      state,
      "--log-level",
      "error",
    ],
    { stdio: "pipe" },
  );
  let log = "";
  server.stderr.on("data", (b) => (log += b));
  server.stdout.on("data", (b) => (log += b));
  const origin = "http://localhost:8788";
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(origin + "/api/auth-config");
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) throw new Error("Test Worker failed to start: " + log);
  const child = spawn(process.execPath, ["scripts/test-api.mjs"], {
    stdio: "inherit",
    env: { ...process.env, BUDGET_TEST_ORIGIN: origin },
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code) process.exitCode = Number(code);
} finally {
  if (server) {
    server.kill("SIGINT");
    await new Promise((r) => server.on("exit", r));
  }
  rmSync(state, { recursive: true, force: true });
}
