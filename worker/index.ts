export { BudgetLive } from "./live";
import { notifyLive } from "./live";
import { OperationSchema, Conflict } from "../shared/model";
import { readState, commit, type Env } from "./store";
import {
  hash,
  random,
  verify,
  session,
  originOkay,
  passwordConfig,
} from "./auth";
import { bankRoute, refreshAvailable, syncAll, webhook } from "./plaid";
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
      ...headers,
    },
  });
async function api(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/plaid/webhook") return webhook(request, env, ctx);
  if (request.method !== "GET" && !originOkay(request))
    return json({ error: "Request origin is not allowed." }, 403);
  if (Number(request.headers.get("Content-Length") || 0) > 2_000_000)
    return json(
      { error: "This upload is too large. Use smaller batches." },
      413,
    );
  if (path === "/api/auth-config" && request.method === "GET") {
    if (!env.PASSWORD_HASH)
      return json(
        { error: "Configure a household password before signing in." },
        503,
      );
    return json(passwordConfig(env.PASSWORD_HASH));
  }
  if (path === "/api/login" && request.method === "POST") {
    if (!env.PASSWORD_HASH)
      return json(
        {
          error:
            "The owner needs to configure the shared password before signing in.",
        },
        503,
      );
    const ip = await hash(request.headers.get("CF-Connecting-IP") || "local");
    const now = Date.now();
    const bucket = Math.floor(now / 600000);
    const key = ip + ":" + bucket;
    const count = await env.DB.prepare(
      "INSERT INTO attempts(key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
      .bind(key, now + 600000)
      .first<{ count: number }>();
    if ((count?.count || 0) > 10)
      return json(
        { error: "Too many attempts. Please try again in ten minutes." },
        429,
        { "Retry-After": "600" },
      );
    const body = (await request.json()) as {
      password: string;
      device?: string;
    };
    if (
      typeof body.password !== "string" ||
      body.password.length > 1000 ||
      !(await verify(body.password, env.PASSWORD_HASH))
    )
      return json({ error: "That password does not match. Try again." }, 401);
    const token = random();
    const csrf = random();
    const device = (body.device || "My device").slice(0, 100);
    await env.DB.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?)")
      .bind(
        await hash(token),
        csrf,
        device,
        now + 180 * 86400000,
        now,
        await hash(env.PASSWORD_HASH),
      )
      .run();
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM attempts WHERE until<?").bind(now).run(),
    );
    return json({ csrf, device }, 200, {
      "Set-Cookie": `budget_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=15552000`,
    });
  }
  const s = await session(request, env);
  if (!s) return json({ error: "Sign in to access your shared budget." }, 401);
  if (
    request.method !== "GET" &&
    request.headers.get("X-CSRF-Token") !== s.csrf
  )
    return json(
      { error: "Your session needs refreshing. Sign in again." },
      403,
    );
  if (path === "/api/live" && request.method === "GET") {
    if (!originOkay(request))
      return json({ error: "Request origin is not allowed." }, 403);
    return env.LIVE.get(env.LIVE.idFromName("household")).fetch(request);
  }
  if (path === "/api/session" && request.method === "GET") {
    await env.DB.prepare("UPDATE sessions SET expires=? WHERE hash=?")
      .bind(Date.now() + 180 * 86400000, s.hash)
      .run();
    const token = request.headers
      .get("Cookie")!
      .match(/(?:^|;\s*)budget_session=([^;]+)/)![1];
    return json({ csrf: s.csrf, device: s.device }, 200, {
      "Set-Cookie": `budget_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=15552000`,
    });
  }
  if (path === "/api/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE hash=?")
      .bind(s.hash)
      .run();
    await notifyLive(env.LIVE, s.hash);
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "budget_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    });
  }
  if (path === "/api/devices" && request.method === "GET")
    return json({
      devices: (
        await env.DB.prepare(
          "SELECT hash,device,created,expires FROM sessions WHERE expires>?",
        )
          .bind(Date.now())
          .all()
      ).results.map((r) => ({ ...r, current: r.hash === s.hash })),
    });
  if (path === "/api/devices/revoke" && request.method === "POST") {
    const b = (await request.json()) as { hash: string; password: string };
    const attempts = await env.DB.prepare(
      "INSERT INTO attempts(key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
      .bind(
        "revoke:" + s.hash + ":" + Math.floor(Date.now() / 600000),
        Date.now() + 600000,
      )
      .first<{ count: number }>();
    if ((attempts?.count || 0) > 10)
      return json({ error: "Try again in ten minutes." }, 429);
    if (typeof b.password !== "string" || b.password.length > 1000)
      return json({ error: "Password does not match." }, 401);
    if (!(await verify(b.password || "", env.PASSWORD_HASH!)))
      return json({ error: "Password does not match." }, 401);
    await env.DB.prepare("DELETE FROM sessions WHERE hash=?")
      .bind(b.hash)
      .run();
    await notifyLive(env.LIVE, b.hash);
    return json({ ok: true });
  }
  if (path === "/api/state" && request.method === "GET")
    return json(await readState(env.DB));
  if (path === "/api/changes" && request.method === "GET") {
    const cursor = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
    const generation = url.searchParams.get("generation");
    const meta = await env.DB.prepare("SELECT * FROM meta").first<{
      revision: number;
      generation: string;
    }>();
    if (meta?.generation !== generation)
      return json({ reset: true, generation: meta?.generation });
    const rows = await env.DB.prepare(
      "SELECT changes.revision,changes.body,operations.id AS operationId FROM changes JOIN operations ON operations.revision=changes.revision WHERE changes.revision>? ORDER BY changes.revision LIMIT 100",
    )
      .bind(cursor)
      .all<{ revision: number; body: string; operationId: string }>();
    return json({
      changes: rows.results.map((r) => ({
        revision: r.revision,
        operationId: r.operationId,
        records: JSON.parse(r.body),
      })),
      hasMore: rows.results.length === 100,
      generation,
    });
  }
  if (path === "/api/operations" && request.method === "POST") {
    const op = OperationSchema.parse(await request.json());
    return json(await commit(env.DB, op, env.LIVE));
  }
  if (path === "/api/audit" && request.method === "GET")
    return json({
      operations: [
        ...(
          await env.DB.prepare(
            "SELECT body FROM restored_audit ORDER BY id",
          ).all<{ body: string }>()
        ).results.map((r) => JSON.parse(r.body)),
        ...(
          await env.DB.prepare(
            "SELECT body,revision FROM operations ORDER BY revision",
          ).all<{ body: string; revision: number }>()
        ).results.map((r) => ({ ...JSON.parse(r.body), revision: r.revision })),
      ],
    });
  if (path.startsWith("/api/banks"))
    return bankRoute(request, env, ctx, s.csrf);
  return json({ error: "Not found." }, 404);
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) {
        if (env.BUDGET_API) return env.BUDGET_API.fetch(request);
        if (request.body) {
          const reader = request.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) {
              await reader.cancel();
              return json(
                { error: "This upload is too large. Use smaller batches." },
                413,
              );
            }
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          request = new Request(request, { body: bytes });
        }
        return await api(request, env, ctx);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Conflict)
        return json({ error: error.message, recordIds: error.recordIds }, 409);
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.name === "ZodError")
      )
        return json({ error: "The submitted data is invalid." }, 400);
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      if (
        /split|envelope|income|Transfer|Record|allocation|Choose|Move/.test(
          message,
        )
      )
        return json({ error: message }, 422);
      console.error(
        "Request failed",
        error instanceof Error ? error.name : "unknown",
      );
      return json(
        {
          error:
            "The server could not complete this request. Your local changes are still saved.",
        },
        503,
      );
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        await syncAll(env);
        await refreshAvailable(env);
      })(),
    );
  },
};
