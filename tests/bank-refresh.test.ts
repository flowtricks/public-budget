import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encrypt } from "../worker/auth";
import { bankRoute, refreshAvailable } from "../worker/plaid";

const attempts = new Map<string, number>();
let connections: any[];
let requests: string[];
const env: any = {
  TOKEN_KEY: "ab".repeat(32),
  PLAID_CLIENT_ID: "test",
  PLAID_SECRET: "test",
  PLAID_ENV: "sandbox",
  PLAID_REFRESH_ENABLED: "true",
  DB: {
    prepare(sql: string) {
      return {
        all: async () => ({ results: connections }),
        bind(...args: any[]) {
          return {
            first: async () => {
              if (sql.startsWith("SELECT * FROM connections WHERE id"))
                return connections.find(
                  (connection) => connection.id === args[0],
                );
              if (sql.startsWith("SELECT until FROM attempts")) {
                const until = attempts.get(args[0]);
                return until === undefined ? null : { until };
              }
              if (sql.startsWith("INSERT INTO attempts")) {
                if (attempts.has(args[0]) && attempts.get(args[0])! > args[2])
                  return null;
                attempts.set(args[0], args[1]);
                return { key: args[0] };
              }
              return null;
            },
            run: async () => {
              if (sql.startsWith("INSERT INTO attempts"))
                attempts.set(args[0], args[1]);
              if (sql.startsWith("DELETE FROM attempts WHERE key"))
                attempts.delete(args[0]);
              if (sql.startsWith("DELETE FROM attempts WHERE until"))
                for (const [key, until] of attempts)
                  if (until < args[0]) attempts.delete(key);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  },
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-04-12T12:17:00Z"));
  attempts.clear();
  requests = [];
  const token = await encrypt("test-token", env.TOKEN_KEY);
  const connection = (id: string, name: string, enabled = 1) => ({
    id,
    name,
    provider: "plaid",
    enabled,
    connected_at: "2025-04-11T00:00:00.000Z",
    connected_on: "2025-04-11",
    selected_accounts: "[]",
    token,
  });
  connections = [
    connection("regions", "Regions Bank"),
    connection("chase", "Chase"),
    connection("capital-one", "Capital One credit card"),
    connection("paused", "Paused bank", 0),
  ];
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify({ ok: true }));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("refreshes supported banks every ten minutes and skips paused and Capital One connections", async () => {
  await refreshAvailable(env);
  expect(requests).toHaveLength(2);
  expect(requests.every((url) => url.endsWith("/transactions/refresh"))).toBe(
    true,
  );

  await refreshAvailable(env);
  expect(requests).toHaveLength(2);

  vi.advanceTimersByTime(420000);
  await refreshAvailable(env);
  expect(requests).toHaveLength(2);

  vi.advanceTimersByTime(180000);
  await refreshAvailable(env);
  expect(requests).toHaveLength(4);
});

it("keeps automatic refresh independent and does not throttle manual requests", async () => {
  await refreshAvailable(env);
  const pending: Promise<unknown>[] = [];
  const manual = () =>
    bankRoute(
      new Request("https://budget.example/api/banks/refresh", {
        method: "POST",
        body: JSON.stringify({ id: "regions" }),
      }),
      env,
      {
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise);
        },
      } as any,
      "",
    );
  expect((await manual()).status).toBe(200);
  await Promise.all(pending);
  expect((await manual()).status).toBe(200);
  await Promise.all(pending);
  expect(requests).toHaveLength(4);

  vi.advanceTimersByTime(600000);
  await refreshAvailable(env);
  expect(requests).toHaveLength(6);
});

it("refreshes all eligible banks with one sync request", async () => {
  const pending: Promise<unknown>[] = [];
  const response = await bankRoute(
    new Request("https://budget.example/api/banks/refresh-all", {
      method: "POST",
      body: "{}",
    }),
    env,
    {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as any,
    "",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ requested: 2, failed: [] });
  expect(
    requests.filter((url) => url.endsWith("/transactions/refresh")),
  ).toHaveLength(2);
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
});

it("reports a failed bank while refreshing the others", async () => {
  const pending: Promise<unknown>[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    return requests.length === 1
      ? new Response(JSON.stringify({ error_code: "INSTITUTION_RATE_LIMIT" }), {
          status: 429,
        })
      : new Response(JSON.stringify({ ok: true }));
  });
  const response = await bankRoute(
    new Request("https://budget.example/api/banks/refresh-all", {
      method: "POST",
      body: "{}",
    }),
    env,
    {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as any,
    "",
  );
  expect(await response.json()).toEqual({
    requested: 1,
    failed: [
      {
        name: "Regions Bank",
        reason: "Plaid is rate limiting this bank. Try again later.",
      },
    ],
  });
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
});

it("cools down a bank for an hour when Plaid reports rate limiting", async () => {
  connections = connections.filter((connection) => connection.id === "regions");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    return requests.length === 1
      ? new Response(JSON.stringify({ error_code: "INSTITUTION_RATE_LIMIT" }), {
          status: 429,
        })
      : new Response(JSON.stringify({ ok: true }));
  });

  await refreshAvailable(env);
  expect(requests).toHaveLength(1);
  vi.advanceTimersByTime(600000);
  await refreshAvailable(env);
  expect(requests).toHaveLength(1);
  vi.advanceTimersByTime(3000000);
  await refreshAvailable(env);
  expect(requests).toHaveLength(2);
});
