import { LiveUpdates } from "./live-updates";
import { openDB, type DBSchema } from "idb";
import {
  applyOperation,
  emptyState,
  makeOperation,
  type State,
  type Operation,
  type BudgetRecord,
} from "../../shared/model";
import { passwordProof } from "../../shared/password";
import { demoState } from "./demo";
interface QueueItem {
  op: Operation;
  error?: string;
  conflict?: boolean;
}
export interface LocalDoc {
  base: State;
  queue: QueueItem[];
  device: string;
  lastSync?: string;
}
interface LocalSchema extends DBSchema {
  docs: { key: string; value: LocalDoc };
}
export interface AppSnapshot {
  phase: "loading" | "login" | "ready";
  doc?: LocalDoc;
  view?: State;
  demo: boolean;
  syncing: boolean;
  status: string;
  error?: string;
  online: boolean;
  readyOffline: boolean;
}
const dbPromise = openDB<LocalSchema>("public-budget-v1", 1, {
  upgrade(db) {
    db.createObjectStore("docs");
  },
});
let key = localStorage.getItem("public-budget-demo") === "yes" ? "demo" : "live";
let snapshot: AppSnapshot = {
  phase: "loading",
  demo: key === "demo",
  syncing: false,
  status: "Opening your budget…",
  online: navigator.onLine,
  readyOffline: false,
};
const subscribers = new Set<() => void>();
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("public-budget-updates")
    : null;
let csrf = "";
let syncTask: Promise<void> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let syncRequested = false;
let lastCheck = 0;
export const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
export const getSnapshot = () => snapshot;
function update(values: Partial<AppSnapshot>) {
  if (
    Object.entries(values).every(([name, value]) =>
      Object.is(snapshot[name as keyof AppSnapshot], value),
    )
  )
    return;
  snapshot = { ...snapshot, ...values };
  for (const fn of subscribers) fn();
}
function project(doc: LocalDoc) {
  let state = doc.base;
  for (const item of doc.queue) {
    try {
      state = applyOperation(state, item.op, false);
    } catch {
      /* Failed commands remain in the queue for explicit review. */
    }
  }
  return state;
}
function publish(doc: LocalDoc) {
  const previous =
    snapshot.demo === (key === "demo") ? snapshot.doc : undefined;
  const sameBase =
    previous?.device === doc.device &&
    previous.base.generation === doc.base.generation &&
    previous.base.revision === doc.base.revision;
  // IndexedDB clones objects. Keep the existing budget identity when only sync
  // metadata changed so screens can retain their computed balances and indexes.
  if (sameBase) doc = { ...doc, base: previous.base };
  const sameQueue =
    sameBase &&
    previous.queue.length === doc.queue.length &&
    previous.queue.every(
      (item, index) => item.op.id === doc.queue[index].op.id,
    );
  update({
    doc,
    view: sameQueue ? snapshot.view : project(doc),
    phase: "ready",
    demo: key === "demo",
  });
  return doc;
}
async function load() {
  const db = await dbPromise;
  const doc = await db.get("docs", key);
  return doc ? publish(doc) : undefined;
}
async function mutate(fn: (doc: LocalDoc) => LocalDoc) {
  const db = await dbPromise;
  const tx = db.transaction("docs", "readwrite");
  const doc = await tx.store.get(key);
  if (!doc) throw new Error("Open a budget before saving.");
  const next = fn(doc);
  if (next === doc) {
    await tx.done;
    publish(doc);
    return;
  }
  await tx.store.put(next, key);
  await tx.done;
  publish(next);
  channel?.postMessage("changed");
}
channel?.addEventListener("message", () => {
  void load();
});
export async function boot() {
  try {
    const doc = await load();
    if (!doc) {
      update({ phase: "login" });
      if (key === "live") {
        try {
          await api("/api/session");
          const state = await api("/api/state");
          await initialize(state);
        } catch {}
      }
    }
    if (key === "live" && snapshot.phase === "ready") void sync();
    else if (key === "demo")
      update({ status: "Sample budget · saved on this device" });
  } catch {
    update({
      phase: "login",
      error:
        "Local storage could not be opened. Check browser storage permissions.",
    });
  }
}
async function initialize(state: State) {
  const db = await dbPromise;
  await db.put(
    "docs",
    {
      base: state,
      queue: [],
      device: crypto.randomUUID(),
      lastSync: new Date().toISOString(),
    },
    key,
  );
  await load();
  if (navigator.storage?.persist) void navigator.storage.persist();
}
export async function login(password: string) {
  const proof = await passwordProof(password, await api("/api/auth-config"));
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      password: proof,
      device: /iPhone/.test(navigator.userAgent) ? "iPhone" : "Browser",
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error);
  csrf = data.csrf;
  key = "live";
  localStorage.removeItem("public-budget-demo");
  update({ demo: false, error: undefined });
  const existing = await load();
  if (!existing) await initialize(await api("/api/state"));
  await sync();
}
export async function explore() {
  live.setEnabled(false);
  key = "demo";
  localStorage.setItem("public-budget-demo", "yes");
  if (!(await load())) await initialize(demoState());
  update({
    demo: true,
    status: "Sample budget · saved on this device",
    error: undefined,
  });
}
export async function exitDemo() {
  key = "live";
  localStorage.removeItem("public-budget-demo");
  update({
    demo: false,
    doc: undefined,
    view: undefined,
    phase: "loading",
    error: undefined,
  });
  await boot();
}
export async function api(path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data: any = await res.json();
  if (!res.ok) {
    const err = new Error(
      data.error || "Could not reach the shared budget.",
    ) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  if (data.csrf) csrf = data.csrf;
  return data;
}
export async function save(
  records: BudgetRecord[],
  label: string,
  guards?: Record<string, number>,
) {
  await mutate((doc) => {
    const view = project(doc);
    for (const record of records) {
      const current = view.records[record.id];
      if (
        record.kind !== "rule" &&
        current &&
        record.version !== current.version
      )
        throw new Error(
          "This item changed while you were editing. Close and reopen it to review the latest version.",
        );
    }
    const op = makeOperation(view, records, doc.device, label, guards);
    applyOperation(view, op);
    if (key === "demo") return { ...doc, base: applyOperation(doc.base, op) };
    return { ...doc, queue: [...doc.queue, { op }] };
  });
  update({
    status:
      key === "demo"
        ? "Sample budget · saved on this device"
        : "Saved on this phone",
    error: undefined,
  });
  if (key === "live") requestSync();
}
async function pull() {
  const doc = snapshot.doc;
  if (!doc) return;
  let cursor = doc.base.revision;
  let more = true;
  while (more) {
    const result = await api(
      `/api/changes?cursor=${cursor}&generation=${encodeURIComponent(doc.base.generation)}`,
    );
    if (result.reset) {
      update({
        error:
          "The shared budget was restored. Export your local changes before resetting this device.",
        status: "Needs review",
      });
      throw new Error("The budget generation changed. Local edits were kept.");
    }
    if (!result.changes.length) break;
    await mutate((current) => {
      const base = { ...current.base, records: { ...current.base.records } };
      for (const change of result.changes) {
        for (const record of change.records) base.records[record.id] = record;
        base.revision = Math.max(base.revision, change.revision);
      }
      return {
        ...current,
        base,
        queue: current.queue.filter(
          (i) =>
            !result.changes.some(
              (c: { operationId: string }) => c.operationId === i.op.id,
            ),
        ),
      };
    });
    cursor = snapshot.doc!.base.revision;
    more = result.hasMore;
  }
}
export async function sync() {
  if (key === "demo" || snapshot.phase !== "ready") return;
  if (syncTask) return syncTask;
  syncRequested = false;
  clearTimeout(retry);
  let succeeded = false;
  const task = async () => {
    update({
      syncing: true,
      ...(snapshot.doc?.queue.length ? { status: "Syncing…" } : {}),
    });
    try {
      await api("/api/session");
      update({ online: true });
      live.setEnabled(document.visibilityState === "visible");
      await load();
      await pull();
      const doc = snapshot.doc;
      const blocked = new Set<string>();
      for (const item of doc?.queue || []) {
        if (
          item.conflict ||
          item.op.patches.some((p) => blocked.has(p.record.id))
        ) {
          item.op.patches.forEach((p) => blocked.add(p.record.id));
          continue;
        }
        try {
          const receipt = await api("/api/operations", item.op);
          await pull();
          if (snapshot.doc?.queue.some((queued) => queued.op.id === item.op.id))
            await mutate((current) =>
              current.base.revision >= receipt.revision &&
              current.queue.some((queued) => queued.op.id === item.op.id)
                ? {
                    ...current,
                    queue: current.queue.filter((i) => i.op.id !== item.op.id),
                  }
                : current,
            );
        } catch (error) {
          const err = error as Error & { status?: number };
          if (err.status === 409 || err.status === 422) {
            await pull();
            await mutate((current) => ({
              ...current,
              queue: current.queue.map((i) =>
                i.op.id === item.op.id
                  ? { ...i, conflict: true, error: err.message }
                  : i,
              ),
            }));
            item.op.patches.forEach((p) => blocked.add(p.record.id));
          } else throw error;
        }
      }
      if (doc?.queue.length) await pull();
      await mutate((current) => ({
        ...current,
        lastSync: new Date().toISOString(),
      }));
      failures = 0;
      succeeded = true;
      lastCheck = Date.now();
      update({
        status: snapshot.doc?.queue.some((i) => i.conflict)
          ? "Changes need review"
          : snapshot.doc?.queue.length
            ? "Saved here · waiting to sync"
            : "All changes synced",
        error: undefined,
      });
    } catch (error) {
      const e = error as Error & { status?: number };
      const auth = e.status === 401 || e.status === 403;
      if (auth) live.setEnabled(false);
      update({
        online: navigator.onLine,
        status: auth
          ? "Sign in to sync"
          : navigator.onLine
            ? "Saved here · waiting to sync"
            : "Offline · saved on this phone",
        error: auth
          ? "Your changes are safe here. Sign in to finish syncing."
          : e.message,
      });
      if (!auth) {
        clearTimeout(retry);
        retry = setTimeout(
          () => void sync(),
          Math.min(60000, 3000 * 2 ** Math.min(5, failures++)),
        );
      }
    } finally {
      update({ syncing: false });
    }
  };
  syncTask = (async () => {
    do {
      syncRequested = false;
      succeeded = false;
      if (navigator.locks)
        await navigator.locks.request("public-budget-sync", task);
      else await task();
    } while (succeeded && syncRequested);
  })().finally(() => {
    syncTask = undefined;
  });
  return syncTask;
}
export async function resolve(id: string, keepLocal: boolean) {
  await mutate((doc) => {
    const index = doc.queue.findIndex((i) => i.op.id === id);
    if (index < 0) return doc;
    const queue = [...doc.queue];
    const item = queue[index];
    if (keepLocal) {
      let view = doc.base;
      for (let i = 0; i < index; i++)
        if (!queue[i].conflict) view = applyOperation(view, queue[i].op, false);
      const op = makeOperation(
        view,
        item.op.patches.map((p) => p.record),
        doc.device,
        item.op.label + " (resolved)",
        item.op.balances,
      );
      applyOperation(view, op);
      queue[index] = { op };
    } else queue.splice(index, 1);
    return { ...doc, queue };
  });
  await sync();
}
export async function logout() {
  if (snapshot.doc?.queue.length)
    throw new Error(
      "Resolve your waiting changes before signing out. Save a recovery CSV first if you need a backup.",
    );
  if (key === "demo") return exitDemo();
  await api("/api/logout", {});
  live.setEnabled(false);
  clearTimeout(retry);
  const db = await dbPromise;
  await db.delete("docs", "live");
  csrf = "";
  update({
    phase: "login",
    doc: undefined,
    view: undefined,
    status: "",
    error: undefined,
  });
}
export function markOfflineReady() {
  update({ readyOffline: true });
}
function requestSync() {
  if (syncTask) syncRequested = true;
  else void sync();
}
const live = new LiveUpdates(requestSync, () => {
  clearTimeout(retry);
  update({
    status: "Sign in to sync",
    error: "Your changes are safe here. Sign in to finish syncing.",
  });
});
window.addEventListener("online", () => {
  update({ online: true });
  void sync();
});
window.addEventListener("offline", () => {
  live.setEnabled(false);
  update({ online: false, status: "Offline · saved on this phone" });
});
function resume() {
  if (
    document.visibilityState !== "visible" ||
    key !== "live" ||
    snapshot.phase !== "ready"
  )
    return;
  // A healthy connection already delivers changes. Dedupe focus/visibility events.
  if (!live.connected || Date.now() - lastCheck > 60000) void sync();
}
window.addEventListener("focus", resume);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resume();
  else live.setEnabled(false);
});
window.addEventListener("pagehide", () => live.setEnabled(false));
window.addEventListener("pageshow", resume);
setInterval(() => {
  if (
    document.visibilityState !== "visible" ||
    key !== "live" ||
    !navigator.onLine
  )
    return;
  // Fallback for blocked sockets, and infrequent reconciliation if a notification
  // was lost or a maintenance import wrote directly to D1.
  if (!live.connected || Date.now() - lastCheck >= 5 * 60000) void sync();
}, 60000);
export async function saveMany(records: BudgetRecord[], label: string) {
  await mutate((doc) => {
    let view = project(doc);
    const remaining = records.map((r) =>
      r.kind === "envelope" ? { ...r, archived: false } : r,
    );
    const ordered = [
      ...remaining.filter(
        (r) => r.kind === "envelope" || r.kind === "settings",
      ),
      ...remaining.filter(
        (r) => r.kind !== "envelope" && r.kind !== "settings",
      ),
    ];
    const ops: Operation[] = [];
    for (let i = 0; i < ordered.length; i += 200) {
      const op = makeOperation(
        view,
        ordered.slice(i, i + 200),
        doc.device,
        label,
      );
      view = applyOperation(view, op);
      ops.push(op);
    }
    const archived = records.filter((r) => r.kind === "envelope" && r.archived);
    for (let i = 0; i < archived.length; i += 200) {
      const op = makeOperation(
        view,
        archived.slice(i, i + 200),
        doc.device,
        label + " · archive",
      );
      view = applyOperation(view, op);
      ops.push(op);
    }
    return key === "demo"
      ? { ...doc, base: view }
      : { ...doc, queue: [...doc.queue, ...ops.map((op) => ({ op }))] };
  });
  if (key === "live") requestSync();
}

export async function revokeSession(id: string, password: string) {
  const proof = await passwordProof(password, await api("/api/auth-config"));
  return api("/api/devices/revoke", { hash: id, password: proof });
}

export async function resetDemo() {
  if (key !== "demo") return;
  await initialize(demoState());
}

export async function loadRestoredBudget() {
  await api("/api/session");
  const state = await api("/api/state");
  await initialize(state);
  await sync();
}
