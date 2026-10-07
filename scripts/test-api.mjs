import WebSocket from "ws";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
const origin = process.env.BUDGET_TEST_ORIGIN;
if (!origin)
  throw new Error("Run npm run test:api for an isolated test database.");
const password = readFileSync(".local-access-password", "utf8").trim();
let cookie = "",
  csrf = "";
async function call(path, body, extra = {}) {
  return fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            Origin: origin,
            "X-CSRF-Token": csrf,
          }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function connect(sessionCookie, requestOrigin = origin) {
  const socket = new WebSocket(origin.replace(/^http/, "ws") + "/api/live", {
    headers: {
      Origin: requestOrigin,
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
  });
  const messages = [];
  socket.on("message", (data) => messages.push(data.toString()));
  const closed = new Promise((resolve) =>
    socket.once("close", (code) => resolve(code)),
  );
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    closed,
    async next(expected) {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const index = messages.indexOf(expected);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Missing live message: " + expected);
    },
  };
}
await assert.rejects(connect(""), /401/);
assert.equal((await call("/api/state")).status, 401);
assert.equal((await call("/api/operations", {})).status, 401);
assert.equal(
  (
    await call(
      "/api/login",
      { password: "wrong" },
      { Origin: "https://attacker.test" },
    )
  ).status,
  403,
);
const config = await (await call("/api/auth-config")).json();
const proof = pbkdf2Sync(
  password,
  config.salt,
  config.iterations,
  32,
  "sha256",
).toString("hex");
const login = await call("/api/login", {
  password: proof,
  device: "Integration test",
});
assert.equal(login.status, 200);
const setCookie = login.headers.get("set-cookie");
assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);
cookie = setCookie.split(";")[0];
csrf = (await login.json()).csrf;
assert.equal(
  (await call("/api/operations", {}, { "X-CSRF-Token": "wrong" })).status,
  403,
);
await assert.rejects(connect(cookie, "https://attacker.test"), /403/);
const secondLogin = await call("/api/login", {
  password: proof,
  device: "Live test second phone",
});
assert.equal(secondLogin.status, 200);
const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
const firstPhone = await connect(cookie);
const secondPhone = await connect(secondCookie);
await Promise.all([
  firstPhone.next('{"type":"ready"}'),
  secondPhone.next('{"type":"ready"}'),
]);
firstPhone.socket.send("ping");
await firstPhone.next("pong");
let state = await (await call("/api/state")).json();
const id = "test-" + crypto.randomUUID();
const env = {
  id,
  kind: "envelope",
  version: 0,
  name: "Integration test (disposable)",
  target: 10000,
  opening: 0,
  icon: "Wallet",
  color: "green",
  order: 100,
  archived: false,
};
const op = {
  id: crypto.randomUUID(),
  device: "integration-test",
  label: "API integration test",
  generation: state.generation,
  createdAt: new Date().toISOString(),
  patches: [{ record: env, expected: null }],
};
if (!state.records.settings.fallbackId)
  op.patches.push({
    record: { ...state.records.settings, fallbackId: id },
    expected: state.records.settings.version,
  });
const result = await call("/api/operations", op);
assert.equal(result.status, 200, await result.clone().text());
const receipt = await result.json();
await Promise.all([
  firstPhone.next('{"type":"changed"}'),
  secondPhone.next('{"type":"changed"}'),
]);
const secondState = await (
  await call("/api/state", undefined, { Cookie: secondCookie })
).json();
assert.equal(secondState.records[id].name, env.name);
const repeat = await (await call("/api/operations", op)).json();
assert.equal(repeat.duplicate, true);
assert.equal(repeat.revision, receipt.revision);
state = await (await call("/api/state")).json();
assert.equal(state.records[id].version, 1);
const stale = { ...op, id: crypto.randomUUID() };
assert.equal((await call("/api/operations", stale)).status, 409);
const change = (label) => ({
  ...op,
  id: crypto.randomUUID(),
  label,
  patches: [{ record: { ...state.records[id], name: label }, expected: 1 }],
});
const raced = await Promise.all([
  call("/api/operations", change("Version A")),
  call("/api/operations", change("Version B")),
]);
assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
const changes = await (
  await call(`/api/changes?generation=${state.generation}&cursor=0`)
).json();
assert.ok(changes.changes.some((c) => c.operationId === op.id));
assert.equal(
  (await call("/api/state")).headers.get("cache-control"),
  "private, no-store",
);
assert.equal((await call("/api/plaid/webhook", {})).status, 404);
const devices = await (await call("/api/devices")).json();
const otherDevice = devices.devices.find(
  (device) => device.device === "Live test second phone",
);
assert.equal(
  (
    await call("/api/devices/revoke", {
      hash: otherDevice.hash,
      password: proof,
    })
  ).status,
  200,
);
assert.equal(await secondPhone.closed, 4001);
assert.equal(
  (await call("/api/state", undefined, { Cookie: secondCookie })).status,
  401,
);
await assert.rejects(connect(secondCookie), /401/);
const logout = await call("/api/logout", {});
assert.equal(await firstPhone.closed, 4001);
assert.equal(logout.status, 200);
assert.equal((await call("/api/state")).status, 401);
console.log(
  "PASS: server auth, secure cookie, origin/CSRF guards, atomic CAS, duplicate retries, change receipts, no-store, webhook guard, session revocation, authenticated live updates to two devices, automatic pongs, and socket revocation.",
);
