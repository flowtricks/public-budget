import { afterEach, expect, it, vi } from "vitest";
import { encrypt } from "../worker/auth";
import { bankRoute } from "../worker/plaid";

afterEach(() => vi.unstubAllGlobals());

it("compares selected post-connection Plaid transactions with imported records", async () => {
  const key = "ab".repeat(32);
  const connection = {
    id: "sample-item",
    name: "Example bank",
    token: await encrypt("access-token", key),
    selected_accounts: '["selected-card"]',
    connected_at: "2025-04-12T04:00:00Z",
    connected_on: "2025-04-11",
  };
  const env: any = {
    TOKEN_KEY: key,
    PLAID_CLIENT_ID: "test",
    PLAID_SECRET: "test",
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => connection,
              all: async () => ({
                results: [{ sourceId: "sample-item:sample" }],
              }),
            };
          },
        };
      },
    },
  };
  const purchase = (id: string, accountId: string, date: string) => ({
    transaction_id: id,
    account_id: accountId,
    date,
    name: id,
    amount: 12.34,
    pending: true,
  });
  vi.stubGlobal("fetch", async () =>
    new Response(
      JSON.stringify({
        added: [
          purchase("sample", "selected-card", "2025-04-12"),
          purchase("other", "unselected-card", "2025-04-12"),
          purchase("old", "selected-card", "2025-04-11"),
        ],
        modified: [],
        removed: [],
        next_cursor: "cursor",
        has_more: false,
      }),
    ),
  );

  const response = await bankRoute(
    new Request("https://budget.example/api/banks/audit?id=sample-item"),
    env,
    {} as ExecutionContext,
    "",
  );
  expect(await response.json()).toMatchObject({
    complete: true,
    availableSinceConnection: 1,
    notImported: 0,
    recent: [
      {
        payee: "sample",
        amount: 1234,
        pending: true,
        imported: true,
      },
    ],
  });
});
