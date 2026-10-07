import { afterEach, expect, it, vi } from "vitest";
import { emptyState } from "../shared/model";

vi.mock("../worker/store", () => ({
  readState: async () => emptyState("test"),
}));

afterEach(() => vi.unstubAllGlobals());

it("uses a different Plaid user for each new bank login and keeps it on the connection", async () => {
  const linkUsers: string[] = [];
  let inserted: unknown[] | undefined;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/link/token/create")) {
      linkUsers.push(body.user.client_user_id);
      return Response.json({ link_token: `link-${linkUsers.length}` });
    }
    if (url.endsWith("/item/public_token/exchange"))
      return Response.json({ item_id: "new-item", access_token: "access" });
    throw new Error(`Unexpected Plaid call: ${url}`);
  });
  const env: any = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => null,
          run: async () => {
            if (sql.startsWith("INSERT INTO connections")) inserted = args;
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
    TOKEN_KEY: "ab".repeat(32),
    PLAID_CLIENT_ID: "client",
    PLAID_SECRET: "secret",
    PLAID_ENV: "sandbox",
  };
  const { bankRoute } = await import("../worker/plaid");
  const request = (path: string, body: object) =>
    new Request(`https://budget.example${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const first = await bankRoute(request("/api/banks/link", {}), env, {} as any, "");
  const second = await bankRoute(request("/api/banks/link", {}), env, {} as any, "");
  const firstLink = await first.json() as any;
  const secondLink = await second.json() as any;
  expect(firstLink.clientUserId).toMatch(/^public-budget-bank-[0-9a-f-]{36}$/);
  expect(secondLink.clientUserId).not.toBe(firstLink.clientUserId);
  expect(linkUsers).toEqual([firstLink.clientUserId, secondLink.clientUserId]);

  const exchange = await bankRoute(
    request("/api/banks/exchange", {
      publicToken: "public",
      name: "Chase",
      clientUserId: firstLink.clientUserId,
    }),
    env,
    {} as any,
    "",
  );
  expect(exchange.status).toBe(200);
  expect(inserted?.at(-1)).toBe(firstLink.clientUserId);
});

it("reuses the saved Plaid user when reconnecting a bank login", async () => {
  let sentUser = "";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sentUser = JSON.parse(String(init.body)).user.client_user_id;
    return Response.json({ link_token: "link" });
  });
  const { encrypt } = await import("../worker/auth");
  const tokenKey = "ab".repeat(32);
  const encrypted = await encrypt("access", tokenKey);
  const env: any = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: "item-one",
            client_user_id: "public-budget-bank-existing-user",
            token: encrypted,
          }),
        }),
      }),
    },
    TOKEN_KEY: tokenKey,
    PLAID_CLIENT_ID: "client",
    PLAID_SECRET: "secret",
  };
  const { bankRoute } = await import("../worker/plaid");
  const response = await bankRoute(
    new Request("https://budget.example/api/banks/link", {
      method: "POST",
      body: JSON.stringify({ id: "item-one" }),
    }),
    env,
    {} as any,
    "",
  );
  expect(response.status).toBe(200);
  expect(sentUser).toBe("public-budget-bank-existing-user");
});
