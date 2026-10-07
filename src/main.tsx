import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";
import { getSnapshot, markOfflineReady } from "./lib/store";
import { AppUpdates, isAppUpdateBlocked } from "./lib/app-updates";
const updates = new AppUpdates(() => {
  const snapshot = getSnapshot();
  return (
    snapshot.phase === "ready" &&
    !snapshot.syncing &&
    !snapshot.doc?.queue.length &&
    !isAppUpdateBlocked()
  );
});
registerSW({
  onOfflineReady: markOfflineReady,
  onRegisteredSW(_url, registration) {
    updates.registered(registration);
  },
  onNeedReload: updates.requestReload,
});
if (import.meta.hot) import.meta.hot.dispose(() => updates.dispose());
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
