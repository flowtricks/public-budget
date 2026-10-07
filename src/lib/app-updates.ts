// Each tab decides when it is safe to reload, even when another tab installs
// the new service worker. Draft forms must survive activation of that worker.
let editing = true;
export function setAppUpdateBlocked(blocked: boolean) {
  editing = blocked;
}
export function isAppUpdateBlocked() {
  return editing;
}

export class AppUpdates {
  private registration?: ServiceWorkerRegistration;
  private checking = false;
  private lastCheck = -Infinity;
  private lastActivity = Date.now();
  private pending = false;
  private reloading = false;
  private reloadTimer?: ReturnType<typeof setInterval>;
  private checkTimer: ReturnType<typeof setInterval>;
  private activityEvents = ["pointerdown", "keydown", "input", "scroll"];

  constructor(
    private canReload: () => boolean,
    private reload: () => void = () => window.location.reload(),
  ) {
    for (const event of this.activityEvents)
      window.addEventListener(event, this.activity, {
        capture: true,
        passive: true,
      });
    window.addEventListener("focus", this.resume);
    window.addEventListener("online", this.resume);
    document.addEventListener("visibilitychange", this.resume);
    this.checkTimer = setInterval(() => void this.check(), 5 * 60_000);
  }

  private activity = () => {
    this.lastActivity = Date.now();
  };

  private resume = () => {
    if (document.visibilityState !== "visible") return;
    this.activity();
    void this.check();
  };

  registered(registration: ServiceWorkerRegistration | undefined) {
    this.registration = registration;
    void this.check();
  }

  private async check() {
    if (
      !this.registration ||
      this.registration.installing ||
      this.checking ||
      !navigator.onLine ||
      document.visibilityState !== "visible" ||
      Date.now() - this.lastCheck < 60_000
    )
      return;
    this.checking = true;
    this.lastCheck = Date.now();
    try {
      await this.registration.update();
    } catch {
      // Keep the cached app usable when a connection or update check fails.
    } finally {
      this.checking = false;
    }
  }

  requestReload = () => {
    this.pending = true;
    if (!this.reloadTimer)
      this.reloadTimer = setInterval(() => this.tryReload(), 1000);
    this.tryReload();
  };

  private tryReload() {
    if (
      !this.pending ||
      this.reloading ||
      document.visibilityState !== "visible" ||
      Date.now() - this.lastActivity < 10_000 ||
      !this.canReload() ||
      document.activeElement?.matches(
        "input, textarea, select, [contenteditable='true']",
      ) ||
      document.querySelector('[role="dialog"], dialog[open]')
    )
      return;
    this.reloading = true;
    clearInterval(this.reloadTimer);
    this.reload();
  }

  dispose() {
    clearInterval(this.checkTimer);
    clearInterval(this.reloadTimer);
    for (const event of this.activityEvents)
      window.removeEventListener(event, this.activity, true);
    window.removeEventListener("focus", this.resume);
    window.removeEventListener("online", this.resume);
    document.removeEventListener("visibilitychange", this.resume);
  }
}
