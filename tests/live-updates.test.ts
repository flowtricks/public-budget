import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveUpdates } from "../src/lib/live-updates";
class Socket {
  static all: Socket[] = [];
  readyState = 0;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor(public url: string) {
    Socket.all.push(this);
  }
  message(data: string) {
    this.onmessage?.({ data });
  }
  ready() {
    this.readyState = 1;
    this.message('{"type":"ready"}');
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Socket.all = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("location", { href: "https://budget.test/" });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live update connection", () => {
  it("catches up on connect and notifications without repeated polling", () => {
    const changed = vi.fn();
    const live = new LiveUpdates(changed, vi.fn());
    live.setEnabled(true);
    const socket = Socket.all[0];
    expect(socket.url).toBe("wss://budget.test/api/live");
    socket.ready();
    expect(live.connected).toBe(true);
    socket.message('{"type":"changed"}');
    expect(changed).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(30000);
      expect(socket.send).toHaveBeenLastCalledWith("ping");
      socket.message("pong");
    }
    expect(Socket.all).toHaveLength(1);
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("reconnects a silent dropped connection and catches up", () => {
    const changed = vi.fn();
    const live = new LiveUpdates(changed, vi.fn());
    live.setEnabled(true);
    Socket.all[0].ready();
    vi.advanceTimersByTime(42000);
    expect(Socket.all[0].close).toHaveBeenCalled();
    expect(Socket.all).toHaveLength(2);
    Socket.all[1].ready();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("keeps a malformed notification URL from throwing into budget sync", () => {
    const live = new LiveUpdates(vi.fn(), vi.fn());
    vi.stubGlobal("location", { href: "invalid" });
    expect(() => live.setEnabled(true)).not.toThrow();
    vi.stubGlobal("location", { href: "https://budget.test/" });
    vi.advanceTimersByTime(1500);
    expect(Socket.all).toHaveLength(1);
  });
  it("stops on logout or backgrounding and ignores stale socket events", () => {
    const changed = vi.fn();
    const live = new LiveUpdates(changed, vi.fn());
    live.setEnabled(true);
    Socket.all[0].ready();
    live.setEnabled(false);
    Socket.all[0].message('{"type":"changed"}');
    vi.advanceTimersByTime(120000);
    expect(Socket.all).toHaveLength(1);
    expect(changed).toHaveBeenCalledTimes(1);
    live.setEnabled(true);
    Socket.all[1].ready();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("stops reconnecting a revoked session", () => {
    const revoked = vi.fn();
    const live = new LiveUpdates(vi.fn(), revoked);
    live.setEnabled(true);
    Socket.all[0].ready();
    Socket.all[0].onclose?.({ code: 4001 });
    expect(revoked).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120000);
    expect(Socket.all).toHaveLength(1);
    expect(live.connected).toBe(false);
  });
});
