import { afterEach, expect, it, vi } from "vitest";
import { encrypt } from "../worker/auth";
import { bankRoute } from "../worker/plaid";

afterEach(() => vi.unstubAllGlobals());

it("reports Plaid's bank update time separately from the app sync time", async () => {
  const key = "ab".repeat(32);
  const env: any = {
    TOKEN_KEY: key,
    PLAID_CLIENT_ID: "test",
    PLAID_SECRET: "test",
    PLAID_ENV: "sandbox",
    PLAID_WEBHOOK_URL: "https://budget.example/api/plaid/webhook",
    DB: {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({
                id: "chase",
                name: "Chase",
                token: await encrypt("access-token", key),
              }),
            };
          },
        };
      },
    },
  };
  vi.stubGlobal("fetch", async () =>
    new Response(
      JSON.stringify({
        item: { webhook: env.PLAID_WEBHOOK_URL, error: null },
        status: {
          transactions: {
            last_successful_update: "2026-10-07T20:20:40Z",
            last_failed_update: null,
          },
        },
      }),
    ),
  );

  const response = await bankRoute(
    new Request("https://budget.example/api/banks/status?id=chase"),
    env,
    {} as ExecutionContext,
    "",
  );
  expect(await response.json()).toMatchObject({
    lastBankUpdate: "2026-10-07T20:20:40Z",
    lastFailedBankUpdate: null,
    webhookMatches: true,
  });
});

it("clears a stale OAuth warning after Plaid reports the item healthy", async () => {
  const key = "ab".repeat(32);
  const connection = {
    id: "chase",
    name: "Chase",
    token: await encrypt("access-token", key),
    error: "The user’s OAuth connection to this institution has been invalidated.",
  };
  let cleared = false;
  const env: any = {
    TOKEN_KEY: key,
    PLAID_CLIENT_ID: "test",
    PLAID_SECRET: "test",
    DB: {
      prepare(sql: string) {
        return {
          bind: () => ({
            first: async () => connection,
            run: async () => {
              if (sql.includes("SET error=NULL")) cleared = true;
            },
          }),
          all: async () => ({ results: [] }),
        };
      },
    },
  };
  vi.stubGlobal("fetch", async () => Response.json({ item: { error: null } }));
  const tasks: Promise<unknown>[] = [];
  const response = await bankRoute(
    new Request("https://budget.example/api/banks/status?id=chase"),
    env,
    { waitUntil: (task: Promise<unknown>) => tasks.push(task) } as ExecutionContext,
    "",
  );
  await Promise.all(tasks);
  expect(response.status).toBe(200);
  expect(cleared).toBe(true);
});

it("does not claim a reconnect succeeded while Plaid still reports an item error", async () => {
  const key = "ab".repeat(32);
  let cleared = false;
  const env: any = {
    TOKEN_KEY: key,
    PLAID_CLIENT_ID: "test",
    PLAID_SECRET: "test",
    DB: {
      prepare(sql: string) {
        return {
          bind: () => ({
            first: async () => ({ id: "chase", token: encrypted, error: "ITEM_LOGIN_REQUIRED" }),
            run: async () => {
              if (sql.includes("SET error=NULL")) cleared = true;
            },
          }),
        };
      },
    },
  };
  const encrypted = await encrypt("access-token", key);
  vi.stubGlobal("fetch", async () => Response.json({ item: { error: { error_code: "ITEM_LOGIN_REQUIRED" } } }));
  const response = await bankRoute(
    new Request("https://budget.example/api/banks/reconnect", {
      method: "POST",
      body: JSON.stringify({ id: "chase" }),
    }),
    env,
    { waitUntil: () => { throw new Error("Sync must not start"); } } as unknown as ExecutionContext,
    "",
  );
  expect(response.status).toBe(409);
  expect(cleared).toBe(false);
});

it("uses the public webhook when linking from the localhost preview", async () => {
  let submitted: any;
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
    submitted = JSON.parse(String(options.body));
    return new Response(JSON.stringify({ link_token: "link-token" }));
  });
  const env: any = {
    PLAID_CLIENT_ID: "test",
    PLAID_SECRET: "test",
    PLAID_ENV: "sandbox",
    PLAID_WEBHOOK_URL: "https://budget.example/api/plaid/webhook",
  };

  const response = await bankRoute(
    new Request("http://127.0.0.1:8787/api/banks/link", {
      method: "POST",
      body: "{}",
    }),
    env,
    {} as ExecutionContext,
    "",
  );
  expect(response.status).toBe(200);
  expect(submitted.webhook).toBe(env.PLAID_WEBHOOK_URL);
});
