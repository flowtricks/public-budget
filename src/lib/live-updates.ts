/** A notification-only socket. All budget reads/writes still use authenticated HTTP. */
export class LiveUpdates {
  private enabled = false;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private failures = 0;

  constructor(
    private changed: () => void,
    private revoked: () => void,
  ) {}

  get connected() {
    return this.socket?.readyState === 1;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      clearTimeout(this.retry);
      this.retry = undefined;
      this.disconnect();
    } else if (!this.socket && !this.retry) this.connect();
  }

  private disconnect() {
    clearTimeout(this.heartbeat);
    clearTimeout(this.deadline);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private reconnect() {
    this.disconnect();
    if (!this.enabled || this.retry) return;
    const delay = Math.min(60000, 1000 * 2 ** Math.min(this.failures++, 6));
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        if (this.enabled) this.connect();
      },
      delay + Math.random() * 500,
    );
  }

  private pingLater(socket: WebSocket) {
    clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(() => {
      if (this.socket !== socket) return;
      try {
        socket.send("ping");
        this.deadline = setTimeout(() => this.reconnect(), 10000);
      } catch {
        this.reconnect();
      }
    }, 30000);
  }

  private connect() {
    if (typeof WebSocket === "undefined") return;
    let socket: WebSocket;
    try {
      const url = new URL("/api/live", location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url.href);
    } catch {
      // Notifications are optional. A malformed socket URL must not stop HTTP sync.
      this.reconnect();
      return;
    }
    this.socket = socket;
    this.deadline = setTimeout(() => this.reconnect(), 10000);
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      if (event.data === "pong") {
        clearTimeout(this.deadline);
        this.pingLater(socket);
        return;
      }
      try {
        const message = JSON.parse(event.data);
        if (message.type === "ready") {
          clearTimeout(this.deadline);
          this.failures = 0;
          this.pingLater(socket);
          this.changed();
        } else if (message.type === "changed") this.changed();
      } catch {
        /* Ignore unknown protocol messages. */
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      if (event.code === 4001) {
        this.setEnabled(false);
        this.revoked();
      } else this.reconnect();
    };
    socket.onerror = () => {
      if (this.socket === socket) this.reconnect();
    };
  }
}
