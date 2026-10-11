import { afterEach, expect, it, vi } from "vitest";
import { encrypt } from "../worker/auth";
import { bankRoute } from "../worker/plaid";

afterEach(() => vi.unstubAllGlobals());

it("compares selected post-connection Plaid transactions with imported records", async () => {
  const key = "ab".repeat(32);
  const connection = {
    id: "chase-item",
    name: "Chase",
    token: await encrypt("access-token", key),
    selected_accounts: '["selected-card"]',
    connected_at: "2026-10-07T04:00:00Z",
    connected_on: "2026-10-06",
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
                results: [{ sourceId: "chase-item:gas" }],
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
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          added: [
            purchase("gas", "selected-card", "2026-10-07"),
            {
              ...purchase("early", "selected-card", "2026-10-07"),
              authorized_datetime: "2026-10-07T00:00:00Z",
            },
            purchase("removed-pending", "selected-card", "2026-10-07"),
            purchase("other", "unselected-card", "2026-10-07"),
            purchase("old", "selected-card", "2026-10-06"),
          ],
          modified: [],
          removed: [{ transaction_id: "removed-pending" }],
          next_cursor: "cursor",
          has_more: false,
        }),
      ),
  );

  const response = await bankRoute(
    new Request(
      "https://budget.example/api/banks/audit?id=chase-item&day=2026-10-07",
    ),
    env,
    {} as ExecutionContext,
    "",
  );
  const audit = (await response.json()) as any;
  expect(audit).toMatchObject({
    complete: true,
    availableSinceConnection: 1,
    availableOnDay: 2,
    notImported: 1,
  });
  expect(audit.recent).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ payee: "gas", imported: true }),
      expect.objectContaining({ payee: "early", imported: false }),
    ]),
  );
});
