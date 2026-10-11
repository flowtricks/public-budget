import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdates, getAppUpdates } from "../src/lib/app-updates";

let win: EventTarget;
let doc: EventTarget & {
  visibilityState: string;
  activeElement: { matches: () => boolean } | null;
  querySelector: ReturnType<typeof vi.fn>;
};
let online: { onLine: boolean };
let updates: AppUpdates;
beforeEach(() => {
  vi.useFakeTimers();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    activeElement: null,
    querySelector: vi.fn(() => null),
  });
  online = { onLine: true };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", online);
});
afterEach(() => {
  updates?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("automatic app updates", () => {
  it("never refreshes for idle time or routine checks without a new version", async () => {
    const reload = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    updates = new AppUpdates(() => true, reload);
    updates.registered({ update } as unknown as ServiceWorkerRegistration);

    // Successful checks mean only that the browser checked for a new worker.
    // They must not be treated as evidence that an update was installed.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(update).toHaveBeenCalledTimes(7);
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(update).toHaveBeenCalledTimes(8);
    expect(reload).not.toHaveBeenCalled();

    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(update).toHaveBeenCalledTimes(9);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads an installed update once after a quiet moment", () => {
    const reload = vi.fn();
    updates = new AppUpdates(() => true, reload);
    updates.requestReload();
    vi.advanceTimersByTime(9000);
    expect(reload).not.toHaveBeenCalled();
    win.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(9000);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledOnce();
    updates.requestReload();
    vi.advanceTimersByTime(30_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("defers a reload from another tab while forms or unsynced edits remain", () => {
    const reload = vi.fn();
    let safe = false;
    updates = new AppUpdates(() => safe, reload);
    updates.requestReload();
    vi.advanceTimersByTime(30_000);
    expect(reload).not.toHaveBeenCalled();
    safe = true;
    doc.querySelector.mockReturnValue({} as never);
    vi.advanceTimersByTime(1000);
    expect(reload).not.toHaveBeenCalled();
    doc.querySelector.mockReturnValue(null);
    doc.activeElement = { matches: () => true };
    vi.advanceTimersByTime(1000);
    expect(reload).not.toHaveBeenCalled();
    doc.activeElement = null;
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps background tabs intact and rechecks safety on return", () => {
    const reload = vi.fn();
    updates = new AppUpdates(() => true, reload);
    doc.visibilityState = "hidden";
    updates.requestReload();
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(9000);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("checks on registration, periodically, and on return without overlapping requests", async () => {
    let finish!: () => void;
    const update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    updates = new AppUpdates(() => true, vi.fn());
    updates.registered({ update } as unknown as ServiceWorkerRegistration);
    expect(update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(update).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    win.dispatchEvent(new Event("focus"));
    expect(update).toHaveBeenCalledTimes(2);
    finish();
    await Promise.resolve();
    win.dispatchEvent(new Event("focus"));
    expect(update).toHaveBeenCalledTimes(2);
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(300_000);
    expect(update).toHaveBeenCalledTimes(2);
    doc.visibilityState = "visible";
    online.onLine = false;
    win.dispatchEvent(new Event("focus"));
    expect(update).toHaveBeenCalledTimes(2);
    online.onLine = true;
    win.dispatchEvent(new Event("online"));
    expect(update).toHaveBeenCalledTimes(3);
    finish();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(update).toHaveBeenCalledTimes(4);
    finish();
  });

  it("recovers from an offline update failure", async () => {
    const reload = vi.fn();
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue(undefined);
    updates = new AppUpdates(() => true, reload);
    updates.registered({ update } as unknown as ServiceWorkerRegistration);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(update).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("manual app updates", () => {
  it("checks for a new worker and reloads even when no update is found", async () => {
    const reload = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const worker = Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: vi.fn().mockResolvedValue({
        update,
        installing: null,
        waiting: null,
      }),
    });
    vi.stubGlobal("navigator", { onLine: true, serviceWorker: worker });
    await getAppUpdates(reload);
    expect(update).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("waits for an installing worker to control the page", async () => {
    const reload = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const worker = Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: vi.fn().mockResolvedValue({ update, installing: {} }),
    });
    vi.stubGlobal("navigator", { onLine: true, serviceWorker: worker });
    Object.assign(win, { setTimeout, clearTimeout });
    const checking = getAppUpdates(reload);
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    worker.controller = {};
    worker.dispatchEvent(new Event("controllerchange"));
    await checking;
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps the current page when offline", async () => {
    const reload = vi.fn();
    vi.stubGlobal("navigator", { onLine: false });
    await expect(getAppUpdates(reload)).rejects.toThrow(/Connect to the internet/);
    expect(reload).not.toHaveBeenCalled();
  });
});
