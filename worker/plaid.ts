import { decrypt, encrypt, hash, constantEqual } from "./auth";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { readState, commit, type Env } from "./store";
import { happenedAfterConnection } from "../shared/bank-filter";
import type { CardAccount } from "../shared/card";
import { bankCardAccount } from "./card-product";
import {
  AUTOMATICALLY_ADDED_TAG,
  withoutAutomaticTag,
} from "../shared/automatic-import";
import {
  defaultEnvelope,
  transactions,
  makeOperation,
  settings,
  type Transaction,
  type BudgetRecord,
} from "../shared/model";
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
type Connection = {
  id: string;
  client_user_id: string;
  name: string;
  provider: string;
  token: string;
  cursor: string | null;
  synced: string | null;
  error: string | null;
  locked_until: number;
  connected_at: string;
  connected_on: string;
  backfill_day: string | null;
  selected_accounts: string;
  enabled: number;
};
async function plaid(env: Env, path: string, body: unknown) {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET)
    throw new Error("Bank connections are not configured yet.");
  const host = env.PLAID_ENV === "production" ? "production" : "sandbox";
  const res = await fetch(`https://${host}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      ...(body as object),
    }),
  });
  const value = (await res.json()) as any;
  if (!res.ok) {
    const error = new Error(
      value.display_message ||
        value.error_code ||
        "The bank could not be reached.",
    );
    (error as Error & { plaidCode?: string }).plaidCode = value.error_code;
    throw error;
  }
  return value;
}
export async function bankRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  _csrf: string,
) {
  const path = new URL(request.url).pathname;
  if (path === "/api/banks" && request.method === "GET") {
    const connections = (
      await env.DB.prepare(
        "SELECT id,name,provider,synced,error,connected_at,connected_on,selected_accounts,enabled FROM connections",
      ).all()
    ).results;
    return json({
      configured: !!(env.PLAID_CLIENT_ID && env.PLAID_SECRET && env.TOKEN_KEY),
      environment: env.PLAID_ENV || "sandbox",
      refreshEnabled: env.PLAID_REFRESH_ENABLED === "true",
      connections: connections.map((c: any) => ({
        id: c.id,
        name: c.name,
        synced: c.synced,
        error: c.error,
        connectedAt: c.connected_at,
        connectedOn: c.connected_on,
        selectedAccountIds: JSON.parse(c.selected_accounts || "[]"),
        enabled: c.enabled === 1,
      })),
    });
  }
  if (path === "/api/banks/status" && request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id");
    const connection = id
      ? await env.DB.prepare("SELECT * FROM connections WHERE id=?")
          .bind(id)
          .first<Connection>()
      : null;
    if (!connection || !env.TOKEN_KEY)
      return json({ error: "Connection not found." }, 404);
    const result = await plaid(env, "/item/get", {
      access_token: await decrypt(connection.token, env.TOKEN_KEY),
    });
    return json({
      name: connection.name,
      lastBankUpdate: result.status?.transactions?.last_successful_update || null,
      lastFailedBankUpdate: result.status?.transactions?.last_failed_update || null,
      itemError: result.item?.error?.error_code || null,
      webhookConfigured: !!result.item?.webhook,
      webhookMatches: result.item?.webhook === env.PLAID_WEBHOOK_URL,
    });
  }
  if (path === "/api/banks/audit" && request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id");
    const connection = id
      ? await env.DB.prepare("SELECT * FROM connections WHERE id=?")
          .bind(id)
          .first<Connection>()
      : null;
    if (!connection || !env.TOKEN_KEY)
      return json({ error: "Connection not found." }, 404);
    const token = await decrypt(connection.token, env.TOKEN_KEY);
    const selected = new Set<string>(
      JSON.parse(connection.selected_accounts || "[]"),
    );
    const rawById = new Map<string, any>();
    let cursor: string | undefined;
    let more = true;
    let pages = 0;
    while (more && pages++ < 15) {
      const result = await plaid(env, "/transactions/sync", {
        access_token: token,
        cursor,
        count: 100,
      });
      for (const raw of [...result.added, ...result.modified])
        rawById.set(raw.transaction_id, raw);
      cursor = result.next_cursor;
      more = result.has_more;
    }
    const stored = (
      await env.DB.prepare(
        "SELECT json_extract(body,'$.sourceId') AS sourceId FROM records WHERE kind='transaction' AND json_extract(body,'$.sourceId') LIKE ?",
      )
        .bind(connection.id + ":%")
        .all<{ sourceId: string }>()
    ).results;
    const storedIds = new Set(stored.map((row) => row.sourceId));
    const eligible = [...rawById.values()].filter(
      (raw) =>
        selected.has(raw.account_id) &&
        happenedAfterConnection(
          raw,
          connection.connected_at,
          connection.connected_on,
        ),
    );
    const recent = eligible
      .sort((a, b) =>
        String(b.authorized_datetime || b.authorized_date || b.date).localeCompare(
          String(a.authorized_datetime || a.authorized_date || a.date),
        ),
      )
      .slice(0, 20)
      .map((raw) => ({
        payee: raw.merchant_name || raw.name || "Bank transaction",
        date: raw.authorized_date || raw.date,
        amount: Math.round(Math.abs(raw.amount) * 100),
        pending: !!raw.pending,
        imported: storedIds.has(connection.id + ":" + raw.transaction_id),
      }));
    return json({
      name: connection.name,
      complete: !more,
      selectedAccounts: selected.size,
      availableSinceConnection: eligible.length,
      notImported: eligible.filter(
        (raw) => !storedIds.has(connection.id + ":" + raw.transaction_id),
      ).length,
      recent,
    });
  }
  if (path === "/api/banks/repair-webhook" && request.method === "POST") {
    const body = (await request.json()) as { id?: string };
    const connection = body.id
      ? await env.DB.prepare("SELECT * FROM connections WHERE id=?")
          .bind(body.id)
          .first<Connection>()
      : null;
    if (!connection || !env.TOKEN_KEY)
      return json({ error: "Connection not found." }, 404);
    if (!env.PLAID_WEBHOOK_URL)
      return json({ error: "Bank notifications are not configured." }, 503);
    await plaid(env, "/item/webhook/update", {
      access_token: await decrypt(connection.token, env.TOKEN_KEY),
      webhook: env.PLAID_WEBHOOK_URL,
    });
    return json({ ok: true });
  }
  if (path === "/api/banks/accounts" && request.method === "POST") {
    const body = (await request.json()) as { id?: string };
    const connection = body.id
      ? await env.DB.prepare("SELECT * FROM connections WHERE id=?")
          .bind(body.id)
          .first<Connection>()
      : null;
    if (!connection || !env.TOKEN_KEY)
      return json({ error: "Connection not found." }, 404);
    const result = await plaid(env, "/accounts/get", {
      access_token: await decrypt(connection.token, env.TOKEN_KEY),
    });
    return json({
      accounts: result.accounts
        .map((account: Record<string, unknown>) =>
          bankCardAccount(account, connection.name),
        )
        .filter(Boolean),
      selectedAccountIds: JSON.parse(connection.selected_accounts || "[]"),
    });
  }
  if (path === "/api/banks/configure" && request.method === "POST") {
    const body = (await request.json()) as {
      id?: string;
      accountIds?: unknown;
    };
    const connection = body.id
      ? await env.DB.prepare("SELECT * FROM connections WHERE id=?")
          .bind(body.id)
          .first<Connection>()
      : null;
    if (!connection || !env.TOKEN_KEY)
      return json({ error: "Connection not found." }, 404);
    if (
      !Array.isArray(body.accountIds) ||
      body.accountIds.length > 100 ||
      body.accountIds.some((id) => typeof id !== "string" || id.length > 150)
    )
      return json({ error: "Choose valid accounts." }, 400);
    const chosen = [...new Set(body.accountIds as string[])];
    const available = await plaid(env, "/accounts/get", {
      access_token: await decrypt(connection.token, env.TOKEN_KEY),
    });
    const allowed = new Set(
      available.accounts.map((account: any) => account.account_id),
    );
    if (chosen.some((id) => !allowed.has(id)))
      return json(
        {
          error:
            "A selected account is not available. Refresh the account list.",
        },
        400,
      );
    await env.DB.prepare(
      "UPDATE connections SET enabled=0,provider='paused' WHERE id=?",
    )
      .bind(connection.id)
      .run();
    await removeDisallowedImports(env, connection, new Set(chosen));
    await env.DB.prepare(
      "UPDATE connections SET selected_accounts=?,enabled=?,provider=?,locked_until=0 WHERE id=?",
    )
      .bind(
        JSON.stringify(chosen),
        chosen.length ? 1 : 0,
        chosen.length ? "plaid" : "paused",
        connection.id,
      )
      .run();
    if (chosen.length) ctx.waitUntil(syncAll(env, connection.id));
    return json({ ok: true });
  }
  if (path === "/api/banks/link" && request.method === "POST") {
    const body = (await request.json()) as { id?: string };
    const existing = body.id
      ? await env.DB.prepare("SELECT * FROM connections WHERE id=?")
          .bind(body.id)
          .first<Connection>()
      : null;
    if (body.id && !existing)
      return json({ error: "Connection not found." }, 404);
    // A household can have separate bank logins belonging to different people.
    // Give each login a stable Plaid user identifier instead of sharing one.
    const clientUserId = existing?.client_user_id ||
      (existing ? `public-budget-bank-${existing.id}` : `public-budget-bank-${crypto.randomUUID()}`);
    const result = await plaid(env, "/link/token/create", {
      user: { client_user_id: clientUserId },
      client_name: "Public Budget",
      ...(existing && env.TOKEN_KEY
        ? {
            access_token: await decrypt(existing.token, env.TOKEN_KEY),
            update: { account_selection_enabled: true },
          }
        : { products: ["transactions"], transactions: { days_requested: 30 } }),
      country_codes: ["US"],
      language: "en",
      ...(env.PLAID_WEBHOOK_URL
        ? { webhook: env.PLAID_WEBHOOK_URL }
        : new URL(request.url).protocol === "https:"
          ? { webhook: new URL("/api/plaid/webhook", request.url).href }
          : {}),
    });
    return json({ linkToken: result.link_token, clientUserId });
  }
  if (path === "/api/banks/exchange" && request.method === "POST") {
    if (!env.TOKEN_KEY)
      return json({ error: "Bank encryption needs configuration." }, 503);
    const body = (await request.json()) as {
      publicToken?: string;
      name?: string;
      clientUserId?: string;
    };
    if (!body.publicToken || typeof body.publicToken !== "string")
      return json({ error: "Finish the bank connection first." }, 400);
    if (!/^public-budget-bank-[0-9a-f-]{36}$/.test(body.clientUserId || ""))
      return json({ error: "Bank link session is missing. Try again." }, 400);
    const result = await plaid(env, "/item/public_token/exchange", {
      public_token: body.publicToken,
    });
    const exists = await env.DB.prepare("SELECT id FROM connections WHERE id=?")
      .bind(result.item_id)
      .first();
    if (!exists) {
      const connectedAt = new Date().toISOString();
      const state = await readState(env.DB);
      const connectedOn = new Intl.DateTimeFormat("en-CA", {
        timeZone: settings(state).timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(connectedAt));
      await env.DB.prepare(
        "INSERT INTO connections(id,name,provider,token,connected_at,connected_on,selected_accounts,enabled,client_user_id) VALUES (?,?,?,?,?,?,'[]',0,?)",
      )
        .bind(
          result.item_id,
          (body.name || "Bank connection").slice(0, 120),
          "paused",
          await encrypt(result.access_token, env.TOKEN_KEY),
          connectedAt,
          connectedOn,
          body.clientUserId,
        )
        .run();
    }
    return json({ ok: true, id: result.item_id });
  }
  if (path === "/api/banks/sync" && request.method === "POST") {
    await syncAll(env);
    return json({ ok: true });
  }
  if (path === "/api/banks/refresh-all" && request.method === "POST") {
    if (env.PLAID_REFRESH_ENABLED !== "true")
      return json(
        {
          error:
            "The owner must verify provider pricing and enable on-demand refresh first.",
        },
        422,
      );
    if (!env.TOKEN_KEY)
      return json({ error: "Bank connections are not configured yet." }, 422);
    const connections = (
      await env.DB.prepare("SELECT * FROM connections").all<Connection>()
    ).results.filter(
      (connection) =>
        connection.provider === "plaid" &&
        connection.enabled === 1 &&
        !/capital one/i.test(connection.name),
    );
    if (!connections.length)
      return json({ error: "No banks are available for refresh." }, 422);
    let requested = 0;
    const failed: { name: string; reason: string }[] = [];
    for (const connection of connections) {
      try {
        await requestRefresh(env, connection, "manual");
        requested++;
      } catch (error) {
        const rateLimited = [
          "TRANSACTIONS_REFRESH_LIMIT",
          "INSTITUTION_RATE_LIMIT",
        ].includes((error as Error & { plaidCode?: string }).plaidCode || "");
        failed.push({
          name: connection.name,
          reason: rateLimited
            ? "Plaid is rate limiting this bank. Try again later."
            : error instanceof Error
              ? error.message
              : "The bank could not be reached.",
        });
      }
    }
    if (requested) ctx.waitUntil(syncAll(env));
    return json({ requested, failed });
  }
  if (path === "/api/banks/refresh" && request.method === "POST") {
    if (env.PLAID_REFRESH_ENABLED !== "true")
      return json(
        {
          error:
            "The owner must verify provider pricing and enable on-demand refresh first.",
        },
        422,
      );
    const b = (await request.json()) as { id: string };
    const c = await env.DB.prepare("SELECT * FROM connections WHERE id=?")
      .bind(b.id)
      .first<Connection>();
    if (!c || !env.TOKEN_KEY)
      return json({ error: "Connection not found." }, 404);
    if (!c.enabled)
      return json({ error: "Choose the bank accounts to import first." }, 422);
    if (/capital one/i.test(c.name))
      return json(
        { error: "Capital One cards use their normal bank update schedule." },
        422,
      );
    try {
      await requestRefresh(env, c, "manual");
    } catch (error) {
      if (
        ["TRANSACTIONS_REFRESH_LIMIT", "INSTITUTION_RATE_LIMIT"].includes(
          (error as Error & { plaidCode?: string }).plaidCode || "",
        )
      )
        return json(
          { error: "Plaid is rate limiting this bank. Try again later." },
          429,
        );
      throw error;
    }
    ctx.waitUntil(syncAll(env));
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}
async function requestRefresh(
  env: Env,
  connection: Connection,
  source: "manual" | "automatic",
) {
  const cooldownKey = "refresh:cooldown:" + connection.id;
  const key = "refresh:automatic:" + connection.id;
  if (source === "automatic") {
    const now = Date.now();
    const cooldown = await env.DB.prepare(
      "SELECT until FROM attempts WHERE key=?",
    )
      .bind(cooldownKey)
      .first<{ until: number }>();
    if (cooldown && cooldown.until > now) return false;
    // Leave room for cron timing jitter so the next ten-minute run can proceed.
    const reserved = await env.DB.prepare(
      "INSERT INTO attempts(key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE attempts.until<=? RETURNING key",
    )
      .bind(key, now + 480000, now)
      .first<{ key: string }>();
    if (!reserved) return false;
  }
  try {
    await plaid(env, "/transactions/refresh", {
      access_token: await decrypt(connection.token, env.TOKEN_KEY!),
    });
  } catch (error) {
    if (source === "automatic")
      await env.DB.prepare("DELETE FROM attempts WHERE key=?").bind(key).run();
    if (
      ["TRANSACTIONS_REFRESH_LIMIT", "INSTITUTION_RATE_LIMIT"].includes(
        (error as Error & { plaidCode?: string }).plaidCode || "",
      )
    )
      await env.DB.prepare(
        "INSERT INTO attempts(key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until",
      )
        .bind(cooldownKey, Date.now() + 3600000)
        .run();
    throw error;
  }
  return true;
}

export async function refreshAvailable(env: Env) {
  if (
    env.PLAID_REFRESH_ENABLED !== "true" ||
    !env.PLAID_CLIENT_ID ||
    !env.PLAID_SECRET ||
    !env.TOKEN_KEY
  )
    return;
  const list = (
    await env.DB.prepare("SELECT * FROM connections").all<Connection>()
  ).results;
  await Promise.all(
    list
      .filter(
        (connection) =>
          connection.provider === "plaid" &&
          connection.enabled === 1 &&
          connection.connected_at &&
          connection.connected_on &&
          !/capital one/i.test(connection.name),
      )
      .map(async (connection) => {
        try {
          await requestRefresh(env, connection, "automatic");
        } catch (error) {
          console.error(
            "Automatic bank refresh failed:",
            connection.id,
            error instanceof Error ? error.message : "Unknown error",
          );
        }
      }),
  );
  await env.DB.prepare("DELETE FROM attempts WHERE until<?")
    .bind(Date.now())
    .run();
}

async function removeDisallowedImports(
  env: Env,
  connection: Connection,
  selected: Set<string>,
) {
  for (;;) {
    const state = await readState(env.DB);
    const disallowed = transactions(state)
      .filter((tx) => {
        if (
          tx.source !== "bank" ||
          tx.deleted ||
          !tx.sourceId?.startsWith(connection.id + ":")
        )
          return false;
        const original = tx.bankOriginal || {};
        return (
          !selected.has(String(original.accountId || "")) ||
          (!happenedAfterConnection(
            {
              authorized_datetime: original.authorizedDatetime as
                string | undefined,
              authorized_date: original.authorizedDate as string | undefined,
              date: String(original.date || tx.date),
            },
            connection.connected_at,
            connection.connected_on,
          ) &&
            !original.backfilledOn)
        );
      })
      .slice(0, 100);
    if (!disallowed.length) return;
    await commit(
      env.DB,
      makeOperation(
        state,
        disallowed.map((tx) => ({
          ...tx,
          deleted: true,
          updatedAt: new Date().toISOString(),
        })),
        "bank:" + connection.id,
        "Remove transactions outside selected accounts or dates",
      ),
      env.LIVE,
    );
  }
}
export async function syncAll(env: Env, onlyItem?: string) {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET || !env.TOKEN_KEY) return;
  const list = (
    await env.DB.prepare("SELECT * FROM connections").all<Connection>()
  ).results;
  for (const c of list) {
    if (onlyItem && c.id !== onlyItem) continue;
    if (
      c.provider !== "plaid" ||
      c.enabled !== 1 ||
      !c.connected_at ||
      !c.connected_on
    )
      continue;
    const lock = await env.DB.prepare(
      "UPDATE connections SET locked_until=? WHERE id=? AND locked_until<?",
    )
      .bind(Date.now() + 300000, c.id, Date.now())
      .run();
    if (!lock.meta.changes) continue;
    try {
      await syncConnection(env, c);
      await env.DB.prepare(
        "UPDATE connections SET error=NULL,synced=?,locked_until=0 WHERE id=?",
      )
        .bind(new Date().toISOString(), c.id)
        .run();
    } catch (e) {
      await env.DB.prepare(
        "UPDATE connections SET error=?,locked_until=0 WHERE id=?",
      )
        .bind(
          (e instanceof Error ? e.message : "Sync failed").slice(0, 400),
          c.id,
        )
        .run();
    }
  }
}
async function syncConnection(env: Env, c: Connection) {
  const token = await decrypt(c.token, env.TOKEN_KEY!);
  const selected = new Set<string>(JSON.parse(c.selected_accounts || "[]"));
  if (!selected.size) return;
  async function selectionUnchanged() {
    const current = await env.DB.prepare(
      "SELECT enabled,selected_accounts,connected_at,connected_on FROM connections WHERE id=?",
    )
      .bind(c.id)
      .first<Connection>();
    if (
      current?.enabled !== 1 ||
      current.selected_accounts !== c.selected_accounts ||
      current.connected_at !== c.connected_at ||
      current.connected_on !== c.connected_on
    )
      throw new Error(
        "Account selection changed during sync. Retrying with the new selection.",
      );
  }
  let cursor = c.cursor || undefined;
  let added: any[] = [];
  let removed: any[] = [];
  let pages = 0;
  let more = true;
  while (more && pages++ < 15) {
    const result = await plaid(env, "/transactions/sync", {
      access_token: token,
      cursor,
      count: 100,
    });
    added.push(...result.added, ...result.modified);
    removed.push(...result.removed);
    cursor = result.next_cursor;
    more = result.has_more;
  }
  if (more)
    throw new Error(
      "Bank history is still preparing. Retry with a smaller initial history window.",
    );
  const accounts = new Map<string, CardAccount>();
  if (added.length) {
    try {
      const result = await plaid(env, "/accounts/get", { access_token: token });
      for (const rawAccount of result.accounts || []) {
        const account = bankCardAccount(rawAccount, c.name);
        if (account) accounts.set(account.id, account);
      }
    } catch {
      // Account details are optional; transaction imports still proceed.
    }
  }
  const pendingReplaced = new Set(
    added.map((t) => t.pending_transaction_id).filter(Boolean),
  );
  const knownSourceIds = new Set(
    transactions(await readState(env.DB))
      .filter((transaction) => transaction.source === "bank")
      .map((transaction) => transaction.sourceId)
      .filter((id): id is string => !!id),
  );
  for (const raw of added) {
    await selectionUnchanged();
    const sourceId = c.id + ":" + raw.transaction_id;
    const pendingId = raw.pending_transaction_id
      ? c.id + ":" + raw.pending_transaction_id
      : undefined;
    const purchaseDay = raw.authorized_date || raw.date;
    const oneTimeBackfill = c.backfill_day === purchaseDay;
    if (
      !selected.has(raw.account_id) ||
      (!happenedAfterConnection(raw, c.connected_at, c.connected_on) &&
        !oneTimeBackfill &&
        !knownSourceIds.has(sourceId) &&
        !(pendingId && knownSourceIds.has(pendingId)))
    )
      continue;
    const state = await readState(env.DB);
    const old = transactions(state).find(
      (t) => t.sourceId === sourceId || (pendingId && t.sourceId === pendingId),
    );
    const amount = Math.round(Math.abs(raw.amount) * 100);
    const payee = raw.merchant_name || raw.name || "Bank transaction";
    const date = raw.authorized_date || raw.date;
    const category = raw.personal_finance_category?.detailed || "";
    const payment = /CREDIT_CARD_PAYMENT/.test(category);
    const movement = /TRANSFER_(IN|OUT)/.test(category);
    const fallback = defaultEnvelope(state, payee);
    if (!fallback && !payment && !movement)
      throw new Error(
        "Choose a default expense envelope before importing purchases.",
      );
    const originalPurchase = transactions(state).find(
      (t) =>
        t.type === "expense" &&
        !t.deleted &&
        !t.excluded &&
        t.payee.toLowerCase() === payee.toLowerCase(),
    );
    const refund =
      raw.amount < 0 &&
      !payment &&
      !movement &&
      !/^INCOME/.test(category) &&
      transactions(state).some(
        (t) =>
          t.type === "expense" && t.payee.toLowerCase() === payee.toLowerCase(),
      );
    const type = raw.amount < 0 ? (refund ? "refund" : "income") : "expense";
    const original = {
      amount,
      date,
      payee,
      category,
      accountId: raw.account_id,
      ...(accounts.has(raw.account_id)
        ? { account: accounts.get(raw.account_id) }
        : {}),
      authorizedDate: raw.authorized_date,
      authorizedDatetime: raw.authorized_datetime,
      ...(oneTimeBackfill || old?.bankOriginal?.backfilledOn
        ? { backfilledOn: oneTimeBackfill ? purchaseDay : old?.bankOriginal?.backfilledOn }
        : {}),
    };
    let tx: Transaction = {
      id: old?.id || "bank:" + sourceId,
      version: old?.version || 0,
      kind: "transaction",
      type,
      payee,
      amount,
      date,
      note: "",
      tags: [AUTOMATICALLY_ADDED_TAG],
      allocations:
        type === "income" || payment || movement
          ? []
          : [
              {
                envelopeId: fallback,
                amount: type === "expense" ? -amount : amount,
              },
            ],
      pending: !!raw.pending,
      deleted: !!old?.deleted && !old.bankOriginal?.removedByBank,
      excluded: payment || movement,
      source: "bank",
      sourceId,
      sourceAccount: c.name,
      bankOriginal: original,
      updatedAt: new Date().toISOString(),
    };
    if (refund && originalPurchase && !old) {
      tx.relatedTransactionId = originalPurchase.id;
      tx.allocations =
        originalPurchase.allocations.length === 1
          ? [{ envelopeId: originalPurchase.allocations[0].envelopeId, amount }]
          : originalPurchase.amount === amount
            ? originalPurchase.allocations.map((a) => ({
                ...a,
                amount: -a.amount,
              }))
            : [
                {
                  envelopeId:
                    originalPurchase.allocations[0]?.envelopeId || fallback,
                  amount,
                },
              ];
      tx.needsReview =
        "Refund matched by merchant. Confirm the original purchase and envelope allocation.";
    }
    if (movement && !payment)
      tx.needsReview =
        "Bank transfer excluded. Review if this should affect your budget.";
    if (old) {
      const changedByUser =
        old.bankOriginal &&
        (old.amount !== old.bankOriginal.amount ||
          old.payee !== old.bankOriginal.payee ||
          old.date !== old.bankOriginal.date ||
          old.note ||
          withoutAutomaticTag(old.tags).length ||
          old.bankOriginal.edited);
      if (changedByUser)
        tx = {
          ...old,
          tags: withoutAutomaticTag(old.tags),
          sourceId,
          pending: !!raw.pending,
          bankOriginal: { ...original, edited: true },
          updatedAt: tx.updatedAt,
          needsReview:
            old.amount !== amount
              ? "The bank changed this amount. Your edited amount has been preserved."
              : old.needsReview,
        };
      else if (old.allocations.length) {
        tx.allocations =
          old.allocations.length === 1
            ? [
                {
                  ...old.allocations[0],
                  amount: type === "expense" ? -amount : amount,
                },
              ]
            : old.allocations;
        if (old.allocations.length > 1 && old.amount !== amount) {
          tx.amount = old.amount;
          tx.needsReview = "Final bank amount changed. Review the exact split.";
        }
      }
      tx.deleted = old.deleted && !old.bankOriginal?.removedByBank;
      tx.excluded = old.excluded;
    }
    if (!old && !payment && !movement) {
      const match = transactions(state).find(
        (t) =>
          t.source !== "bank" &&
          !t.deleted &&
          t.amount === amount &&
          t.date === date &&
          t.payee.toLowerCase() === payee.toLowerCase(),
      );
      if (match) {
        tx.excluded = true;
        tx.needsReview = `Possible duplicate of ${match.payee} on ${match.date}. Excluded until you review.`;
      }
    }
    const patches: BudgetRecord[] = [tx];
    if (tx.type === "refund" && !tx.deleted && !tx.excluded)
      for (const a of tx.allocations) {
        const envelope = state.records[a.envelopeId];
        if (envelope?.kind === "envelope" && envelope.archived)
          patches.push({ ...envelope, archived: false });
      }
    const op = makeOperation(
      state,
      patches,
      "bank:" + c.id,
      "Bank update: " + payee,
    );
    await commit(env.DB, op, env.LIVE);
  }
  for (const raw of removed) {
    if (pendingReplaced.has(raw.transaction_id)) continue;
    const state = await readState(env.DB);
    const old = transactions(state).find(
      (t) => t.sourceId === c.id + ":" + raw.transaction_id,
    );
    if (old && !old.deleted)
      await commit(
        env.DB,
        makeOperation(
          state,
          [
            {
              ...old,
              deleted: true,
              bankOriginal: { ...old.bankOriginal, removedByBank: true },
              updatedAt: new Date().toISOString(),
            },
          ],
          "bank:" + c.id,
          "Bank removed transaction",
        ),
        env.LIVE,
      );
  }
  await selectionUnchanged();
  await env.DB.prepare("UPDATE connections SET cursor=?,backfill_day=NULL WHERE id=?")
    .bind(cursor || null, c.id)
    .run();
}

export async function webhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  if (request.method !== "POST" || !env.PLAID_SECRET)
    return json({ error: "Unavailable" }, 404);
  try {
    const token = request.headers.get("Plaid-Verification");
    if (!token || token.length > 10000)
      return json({ error: "Invalid signature" }, 401);
    const header = decodeProtectedHeader(token);
    if (header.alg !== "ES256" || typeof header.kid !== "string")
      return json({ error: "Invalid signature" }, 401);
    const raw = await request.text();
    if (raw.length > 100000) return json({ error: "Too large" }, 413);
    const result = await plaid(env, "/webhook_verification_key/get", {
      key_id: header.kid,
    });
    if (result.key.expired_at) return json({ error: "Expired key" }, 401);
    const key = await importJWK(result.key, "ES256");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["ES256"],
      maxTokenAge: "5 min",
    });
    if (
      typeof payload.request_body_sha256 !== "string" ||
      !constantEqual(await hash(raw), payload.request_body_sha256)
    )
      return json({ error: "Invalid body" }, 401);
    const body = JSON.parse(raw);
    if (
      typeof body.item_id === "string" &&
      ["TRANSACTIONS", "ITEM"].includes(body.webhook_type)
    )
      ctx.waitUntil(syncAll(env, body.item_id));
    return json({ ok: true });
  } catch {
    return json({ error: "Invalid webhook" }, 401);
  }
}
