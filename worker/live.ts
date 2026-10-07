import { hash, originOkay, session, type Session } from "./auth";
import type { Env } from "./store";

// This object coordinates notifications only. D1 remains the source of truth.
// acceptWebSocket + automatic pongs let Cloudflare hibernate between changes.
export class BudgetLive {
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/notify" && request.method === "POST") {
      const version = this.env.PASSWORD_HASH
        ? await hash(this.env.PASSWORD_HASH)
        : "";
      // Recheck authorization before sending even a change notification. This
      // also covers expired sessions, password rotation, and revocation races.
      const sessions = new Map<string, boolean>();
      for (const socket of this.ctx.getWebSockets()) {
        const id = socket.deserializeAttachment() as string;
        if (!sessions.has(id)) {
          const s = await this.env.DB.prepare(
            "SELECT * FROM sessions WHERE hash=? AND expires>?",
          )
            .bind(id, Date.now())
            .first<Session>();
          sessions.set(id, !!s && s.password_version === version);
        }
        if (!sessions.get(id)) socket.close(4001, "Sign in again");
        else {
          try {
            socket.send('{"type":"changed"}');
          } catch {
            socket.close(1011, "Reconnect");
          }
        }
      }
      return new Response(null, { status: 204 });
    }
    if (path === "/revoke" && request.method === "POST") {
      const { hash: id } = (await request.json()) as { hash: string };
      for (const socket of this.ctx.getWebSockets(id))
        socket.close(4001, "Sign in again");
      return new Response(null, { status: 204 });
    }
    if (path !== "/api/live" || request.method !== "GET")
      return new Response(null, { status: 404 });
    if (!originOkay(request)) return new Response(null, { status: 403 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response(null, { status: 426 });
    const s = await session(request, this.env);
    if (!s) return new Response(null, { status: 401 });
    if (this.ctx.getWebSockets(s.hash).length >= 20)
      return new Response(null, { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [s.hash]);
    server.serializeAttachment(s.hash);
    // Catch up after subscribing: closes the gap between HTTP sync and connect.
    server.send('{"type":"ready"}');
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket) {
    // The socket cannot write budget data. Only automatic heartbeat is accepted.
    socket.close(1008, "Use the authenticated API to save changes");
  }
  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Reconnect");
  }
}

export async function notifyLive(
  live: DurableObjectNamespace | undefined,
  sessionHash?: string,
) {
  if (!live) return;
  try {
    const res = await live
      .get(live.idFromName("household"))
      .fetch(`https://live.internal/${sessionHash ? "revoke" : "notify"}`, {
        method: "POST",
        body: sessionHash ? JSON.stringify({ hash: sessionHash }) : undefined,
      });
    if (!res.ok) throw new Error("Notification failed");
  } catch {
    // A notification failure must never undo or misreport a committed edit.
    // Reconnect and occasional reconciliation recover missed notifications.
    console.error("Live notification unavailable");
  }
}
