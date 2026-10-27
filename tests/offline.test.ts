import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  emptyState,
  applyOperation,
  makeOperation,
  balances,
  type State,
  type Operation,
  type Envelope,
} from "../shared/model";
let remote: State;
let history: { revision: number; operationId: string; records: any[] }[];
let receipts = new Map<string, number>();
let online = true;
let loseAcknowledgment = false;
let commits = 0;
const envelope = (id: string): Envelope => ({
  id,
  kind: "envelope",
  version: 0,
  name: id,
  target: 10000,
  opening: 0,
  icon: "Wallet",
  color: "blue",
  order: 0,
  archived: false,
});
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  vi.stubGlobal("navigator", {
    onLine: true,
    storage: { persist: async () => true },
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("WebSocket", undefined);
  remote = emptyState("test");
  history = [];
  receipts = new Map();
  online = true;
  loseAcknowledgment = false;
  commits = 0;
  vi.stubGlobal("fetch", async (path: string, options: any = {}) => {
    if (!online) throw new Error("Offline");
    const url = new URL(path, "https://budget.test");
    let data: any;
    let status = 200;
    if (url.pathname === "/api/auth-config")
      data = {
        algorithm: "PBKDF2-SHA256",
        iterations: 600000,
        salt: "a".repeat(64),
      };
    else if (url.pathname === "/api/login" || url.pathname === "/api/session")
      data = { csrf: "test-csrf" };
    else if (url.pathname === "/api/state") data = remote;
    else if (url.pathname === "/api/changes")
      data = {
        changes: history.filter(
          (c) => c.revision > Number(url.searchParams.get("cursor")),
        ),
        hasMore: false,
      };
    else if (url.pathname === "/api/operations") {
      const op: Operation = JSON.parse(options.body);
      if (receipts.has(op.id))
        data = { revision: receipts.get(op.id), duplicate: true };
      else {
        try {
          const before = remote;
          remote = applyOperation(remote, op);
          receipts.set(op.id, remote.revision);
          history.push({
            revision: remote.revision,
            operationId: op.id,
            records: Object.values(remote.records).filter(
              (r) => r !== before.records[r.id],
            ),
          });
          commits++;
          data = { revision: remote.revision };
          if (loseAcknowledgment) {
            loseAcknowledgment = false;
            online = false;
            throw new Error("Lost response");
          }
        } catch (e) {
          if (!online) throw e;
          status = 409;
          data = { error: (e as Error).message };
        }
      }
    } else throw new Error("Unexpected " + path);
    return new Response(JSON.stringify(data), { status });
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start() {
  const store = await import("../src/lib/store");
  await store.login("mock");
  await store.save(
    [
      envelope("food"),
      {
        ...(store.getSnapshot().view!.records.settings as any),
        fallbackId: "food",
      },
    ],
    "Setup",
  );
  await store.sync();
  expect(store.getSnapshot().error).toBeUndefined();
  expect(commits).toBe(1);
  return store;
}
describe("offline outbox", () => {
  it("sends queued edits even when the live notification URL is invalid", async () => {
    vi.stubGlobal("location", { pathname: "/", href: "invalid" });
    vi.stubGlobal("WebSocket", class {});
    const store = await start();
    await store.save(
      [{ ...store.getSnapshot().view!.records.food, name: "Groceries" } as Envelope],
      "Edit envelope",
    );
    await store.sync();
    expect(store.getSnapshot().doc?.queue).toHaveLength(0);
    expect((remote.records.food as Envelope).name).toBe("Groceries");
    expect(store.getSnapshot().error).toBeUndefined();
  });
  it("catches a live notification arriving after an in-flight pull took its snapshot", async () => {
    let socket: any;
    vi.stubGlobal("location", { href: "https://budget.test/" });
    vi.stubGlobal(
      "WebSocket",
      class {
        readyState = 1;
        close() {}
        send() {}
        constructor() {
          socket = this;
        }
      },
    );
    const store = await start();
    const normally = fetch;
    let release!: () => void;
    let announce!: () => void;
    const pending = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    vi.stubGlobal("fetch", async (path: string, options: any) => {
      const response = await normally(path, options);
      if (path.startsWith("/api/changes") && !held) {
        held = true;
        announce();
        await gate;
      }
      return response;
    });
    const syncing = store.sync();
    await pending;
    expect(store.getSnapshot().status).toBe("All changes synced");
    const op = makeOperation(
      remote,
      [{ ...remote.records.food, name: "Other phone" } as Envelope],
      "other",
      "Rename",
    );
    const before = remote;
    remote = applyOperation(remote, op);
    history.push({
      revision: remote.revision,
      operationId: op.id,
      records: Object.values(remote.records).filter(
        (r) => r !== before.records[r.id],
      ),
    });
    socket.onmessage({ data: '{"type":"changed"}' });
    release();
    await syncing;
    expect((store.getSnapshot().view!.records.food as Envelope).name).toBe(
      "Other phone",
    );
    expect(store.getSnapshot().doc?.queue).toHaveLength(0);
  });

  it("keeps the rendered budget stable when syncing finds no changes", async () => {
    const store = await start();
    const view = store.getSnapshot().view;
    const seen: State[] = [];
    const unsubscribe = store.subscribe(() =>
      seen.push(store.getSnapshot().view!),
    );
    await store.sync();
    unsubscribe();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((state) => state === view)).toBe(true);
    expect(store.getSnapshot().syncing).toBe(false);
    expect(store.getSnapshot().doc?.queue).toHaveLength(0);
  });
  it("keeps the budget ready and accepts local edits while a sync request is pending", async () => {
    const store = await start();
    const fetchNormally = fetch;
    let release!: () => void;
    let announce!: () => void;
    const pending = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    vi.stubGlobal("fetch", async (path: string, options: any) => {
      if (path.startsWith("/api/changes") && !held) {
        held = true;
        announce();
        await gate;
      }
      return fetchNormally(path, options);
    });
    const syncing = store.sync();
    await pending;
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().syncing).toBe(true);
    await store.save(
      [
        {
          ...store.getSnapshot().view!.records.food,
          name: "Edited during sync",
        } as Envelope,
      ],
      "Rename during sync",
    );
    expect((store.getSnapshot().view!.records.food as Envelope).name).toBe(
      "Edited during sync",
    );
    expect(store.getSnapshot().doc?.queue).toHaveLength(1);
    release();
    await syncing;
    expect((remote.records.food as Envelope).name).toBe("Edited during sync");
    expect(store.getSnapshot().doc?.queue).toHaveLength(0);
  });
  it("saves edits while offline and catches up without duplicates", async () => {
    const store = await start();
    online = false;
    const state = store.getSnapshot().view!;
    await store.save(
      [{ ...state.records.food, name: "Groceries" } as Envelope],
      "Rename",
    );
    await store.sync();
    expect(store.getSnapshot().doc?.queue).toHaveLength(1);
    expect((store.getSnapshot().view!.records.food as Envelope).name).toBe(
      "Groceries",
    );
    online = true;
    await store.sync();
    expect(store.getSnapshot().doc?.queue).toHaveLength(0);
    expect((remote.records.food as Envelope).name).toBe("Groceries");
    expect(commits).toBe(2);
  });
  it("losing an accepted response keeps the command until its receipt arrives", async () => {
    const store = await start();
    loseAcknowledgment = true;
    await store.save(
      [{ ...store.getSnapshot().view!.records.food, name: "Food" } as Envelope],
      "Rename",
    );
    await store.sync();
    expect(store.getSnapshot().doc?.queue).toHaveLength(1);
    expect(commits).toBe(2);
    online = true;
    await store.sync();
    expect(store.getSnapshot().doc?.queue).toHaveLength(0);
    expect(commits).toBe(2);
    expect(store.getSnapshot().view!.records.food.version).toBe(
      remote.records.food.version,
    );
  });
  it("keeps both versions when another phone changes the same envelope", async () => {
    const store = await start();
    online = false;
    await store.save(
      [
        {
          ...store.getSnapshot().view!.records.food,
          name: "Local food",
        } as Envelope,
      ],
      "Local rename",
    );
    await store.sync();
    const other = makeOperation(
      remote,
      [{ ...remote.records.food, name: "Shared food" } as Envelope],
      "phone2",
      "Other rename",
    );
    const before = remote;
    remote = applyOperation(remote, other);
    history.push({
      revision: remote.revision,
      operationId: other.id,
      records: Object.values(remote.records).filter(
        (r) => r !== before.records[r.id],
      ),
    });
    online = true;
    await store.sync();
    expect(store.getSnapshot().doc?.queue[0].conflict).toBe(true);
    expect((remote.records.food as Envelope).name).toBe("Shared food");
    const id = store.getSnapshot().doc!.queue[0].op.id;
    await store.resolve(id, true);
    expect((remote.records.food as Envelope).name).toBe("Local food");
    expect(store.getSnapshot().doc?.queue).toHaveLength(0);
  });
  it("rejects saving a stale open editor after a newer local edit", async () => {
    const store = await start();
    const old = store.getSnapshot().view!.records.food as Envelope;
    await store.save([{ ...old, name: "Newer" }], "Rename");
    await store.sync();
    await expect(
      store.save([{ ...old, name: "Stale" }], "Stale"),
    ).rejects.toThrow(/while you were editing/);
  });
});
