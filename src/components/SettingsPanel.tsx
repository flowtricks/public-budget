import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  Landmark,
  Plus,
  RefreshCw,
  LogOut,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { Field } from "./ui";
import Select from "./Select";
import {
  api,
  save,
  saveMany,
  logout,
  revokeSession,
  resetDemo,
  sync,
  getSnapshot,
  type AppSnapshot,
} from "../lib/store";
import {
  settings,
  envelopes,
  transactions,
  applyOperation,
  emptyState,
  type BudgetRecord,
  type State,
  type Envelope,
  today,
} from "../../shared/model";
import {
  exportCSV,
  download,
  parseTable,
  guessMapping,
  goodbudgetPreview,
  parseRestore,
  type ImportMapping,
} from "../lib/csv";
declare global {
  interface Window {
    Plaid?: {
      create: (options: {
        token: string;
        onSuccess: (
          token: string | null,
          metadata: {
            institution?: { name: string };
            accounts?: { id: string }[];
          },
        ) => void;
        onExit: () => void;
      }) => { open: () => void; destroy: () => void };
    };
  }
}
export default function SettingsPanel({
  snapshot: snap,
  onSaved,
}: {
  snapshot: AppSnapshot;
  onSaved: (s: string) => void;
}) {
  const state = snap.view!;
  const [tab, setTab] = useState("banks");
  const [timezone, setTimezone] = useState(settings(state).timezone);
  const [fallback, setFallback] = useState(settings(state).fallbackId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preferenceWrites = useRef(Promise.resolve());
  const savePreference = useCallback(
    (
      patch: Partial<
        Pick<ReturnType<typeof settings>, "timezone" | "fallbackId">
      >,
    ) => {
      preferenceWrites.current = preferenceWrites.current
        .then(async () => {
          const current = settings(getSnapshot().view!);
          if (
            Object.entries(patch).every(
              ([key, value]) => current[key as keyof typeof current] === value,
            )
          )
            return;
          setError("");
          await save([{ ...current, ...patch }], "Update household settings");
        })
        .catch((e: Error) => setError(e.message));
    },
    [],
  );
  const [banks, setBanks] = useState<any>();
  const [bankStatuses, setBankStatuses] = useState<
    Record<
      string,
      {
        lastBankUpdate: string | null;
        lastFailedBankUpdate: string | null;
        itemError: string | null;
        webhookConfigured: boolean;
        webhookMatches: boolean;
        error?: string;
      }
    >
  >({});
  const bankNeedsReconnect = (bank: { id: string; error?: string | null }) =>
    bankStatuses[bank.id]?.itemError === "ITEM_LOGIN_REQUIRED" ||
    bank.error === "ITEM_LOGIN_REQUIRED" ||
    /oauth connection.*invalidated/i.test(bank.error || "");
  const refreshableBanks = (banks?.connections || []).filter(
    (bank: { enabled: boolean; name: string }) =>
      bank.enabled && !/capital one/i.test(bank.name),
  );
  const [bankAccounts, setBankAccounts] = useState<
    Record<
      string,
      {
        id: string;
        name: string;
        officialName?: string | null;
        mask?: string | null;
        type: string;
        subtype?: string | null;
      }[]
    >
  >({});
  const [accountChoices, setAccountChoices] = useState<
    Record<string, string[]>
  >({});
  const [devices, setDevices] = useState<any[]>([]);
  const [table, setTable] = useState<{
    headers: string[];
    rows: Record<string, string>[];
  } | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>();
  const [batch, setBatch] = useState("");
  const [preview, setPreview] = useState<{
    records: BudgetRecord[];
    errors: string[];
  }>();
  const [importConfirm, setImportConfirm] = useState(false);
  const [restore, setRestore] = useState<State>();
  const [revoke, setRevoke] = useState("");
  const [password, setPassword] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (snap.demo) return;
    if (tab === "banks")
      void run(async () => {
        const nextBanks = await api("/api/banks");
        setBanks(nextBanks);
        const statuses = await Promise.all(
          (nextBanks.connections || []).map(async (bank: { id: string }) => {
            try {
              return [
                bank.id,
                await api(
                  `/api/banks/status?id=${encodeURIComponent(bank.id)}`,
                ),
              ];
            } catch (error) {
              return [bank.id, { error: (error as Error).message }];
            }
          }),
        );
        setBankStatuses(Object.fromEntries(statuses));
      });
    if (tab === "devices")
      void run(async () => setDevices((await api("/api/devices")).devices));
  }, [tab]);
  async function exportAll() {
    if (!snap.demo && snap.online) await sync();
    const current = getSnapshot();
    let audit: unknown[] = [];
    if (!snap.demo && snap.online) {
      audit = (await api("/api/audit")).operations.filter(
        (op: { revision?: number }) =>
          op.revision === undefined ||
          op.revision <= current.doc!.base.revision,
      );
    }
    download(
      exportCSV(
        current.doc!.base,
        current.doc!.queue.map((i) => i.op),
        audit,
      ),
      `budget-${today()}.csv`,
    );
    onSaved(
      snap.doc?.queue.length
        ? "Export includes your queued edits"
        : "Budget exported",
    );
  }
  async function loadFile(file: File) {
    const text = await file.text();
    if (text.length > 25_000_000)
      throw new Error("Choose a CSV smaller than 25 MB.");
    setPreview(undefined);
    setRestore(undefined);
    setTable(null);
    setImportConfirm(false);
    if (text.includes("payload_json") && text.includes("record_type")) {
      const parsed = parseRestore(text);
      let restored = parsed.state;
      for (const op of parsed.queue)
        restored = applyOperation(restored, op, false);
      setRestore(restored);
      return;
    }
    const parsed = parseTable(text);
    setTable(parsed);
    setMapping(guessMapping(parsed.headers));
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    setBatch(
      "import:" +
        Array.from(new Uint8Array(digest))
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 24),
    );
  }
  async function doImport() {
    if (!importConfirm)
      throw new Error(
        "Confirm the preview and amount convention before importing.",
      );
    if (restore) {
      if (envelopes(state).length || transactions(state).length)
        throw new Error(
          "Restore is available only into an empty budget, so it cannot overwrite existing money. Use a fresh database for a complete restore.",
        );
      const list = Object.values(restore.records);
      await saveMany(
        list.map((r) => ({ ...r, version: 0 })),
        "Restore CSV",
      );
      onSaved("Budget restored");
      return;
    }
    if (!preview || preview.errors.length)
      throw new Error("Resolve every row error before importing.");
    const existing = envelopes(state);
    const remap = new Map<string, string>();
    for (const r of preview.records)
      if (r.kind === "envelope") {
        const found = existing.find(
          (e) => e.name.toLowerCase() === r.name.toLowerCase(),
        );
        if (found) remap.set(r.id, found.id);
      }
    const records = preview.records
      .filter(
        (r) =>
          !state.records[r.id] && !(r.kind === "envelope" && remap.has(r.id)),
      )
      .map((r) =>
        r.kind === "transaction"
          ? {
              ...r,
              allocations: r.allocations.map((a) => ({
                ...a,
                envelopeId: remap.get(a.envelopeId) || a.envelopeId,
              })),
            }
          : r,
      );
    if (!records.length)
      throw new Error("All rows from this exact file are already imported.");
    if (!settings(state).fallbackId) {
      const first = records.find((r) => r.kind === "envelope");
      if (!first) throw new Error("Create a default envelope first.");
      records.unshift({ ...settings(state), fallbackId: first.id });
    }
    await saveMany(records, "Import Goodbudget CSV");
    onSaved(
      `${records.filter((r) => r.kind === "transaction").length} transactions imported`,
    );
  }
  async function linkBank(id?: string) {
    if (!window.Plaid)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(
            new Error("Could not load bank linking. Check your connection."),
          );
        document.head.append(script);
      });
    const link = await api("/api/banks/link", { id });
    const handler = window.Plaid!.create({
      token: link.linkToken,
      onSuccess: (publicToken, metadata) => {
        void run(async () => {
          let connectedId = id;
          if (!id) {
            const result = await api("/api/banks/exchange", {
              publicToken,
              name: metadata.institution?.name || "Bank connection",
              clientUserId: link.clientUserId,
            });
            connectedId = result.id;
          }
          if (id) await api("/api/banks/sync", {});
          setBanks(await api("/api/banks"));
          if (connectedId) await loadBankAccounts(connectedId);
          onSaved(
            id
              ? "Bank reconnected. Checking for missed transactions."
              : "Bank connected. Choose the accounts to import.",
          );
          handler.destroy();
        });
      },
      onExit: () => handler.destroy(),
    });
    handler.open();
  }
  async function loadBankAccounts(id: string) {
    const result = await api("/api/banks/accounts", { id });
    setBankAccounts((current) => ({ ...current, [id]: result.accounts }));
    setAccountChoices((current) => ({
      ...current,
      [id]: result.selectedAccountIds,
    }));
  }
  async function saveBankAccounts(id: string) {
    await api("/api/banks/configure", {
      id,
      accountIds: accountChoices[id] || [],
    });
    setBanks(await api("/api/banks"));
    onSaved(
      accountChoices[id]?.length
        ? "Selected accounts saved. Only new transactions will import."
        : "Bank import paused.",
    );
  }
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-tabs">
        {[
          ["banks", "Bank connections"],
          ["general", "General"],
          ["data", "Your data"],
          ["devices", "Devices"],
        ].map(([v, label]) => (
          <button
            key={v}
            className={tab === v ? "active" : ""}
            onClick={() => {
              setTab(v);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="form-body settings-body">
        {tab === "general" && (
          <>
            <Field
              label="Default expense envelope"
              hint="New merchants use this envelope. Your latest single-envelope correction is remembered for that merchant."
            >
              <Select
                label="Default expense envelope"
                searchable
                value={fallback}
                onChange={(value) => {
                  setFallback(value);
                  savePreference({ fallbackId: value });
                }}
                options={[
                  { value: "", label: "Choose an envelope" },
                  ...envelopes(state)
                    .filter((e) => !e.archived)
                    .map((e) => ({ value: e.id, label: e.name })),
                ]}
              />
            </Field>
            <Field label="Household time zone">
              <Select
                label="Household time zone"
                value={timezone}
                onChange={(value) => {
                  setTimezone(value);
                  savePreference({ timezone: value });
                }}
                options={[
                  "America/Chicago",
                  "America/New_York",
                  "America/Denver",
                  "America/Los_Angeles",
                  "America/Anchorage",
                  "Pacific/Honolulu",
                  "UTC",
                ].map((t) => ({ value: t, label: t }))}
              />
            </Field>
            {snap.demo && (
              <button
                className="text-button"
                onClick={() =>
                  void run(async () => {
                    await resetDemo();
                    onSaved("Sample reset");
                  })
                }
              >
                Reset sample budget
              </button>
            )}
          </>
        )}
        {tab === "banks" && (
          <>
            <div className="settings-intro">
              <span className="envelope-icon green">
                <Landmark size={22} />
              </span>
              <h3>A little less manual entry</h3>
              <p>
                Connect each bank login, then choose the exact accounts to
                import. Only transactions made after the connection are added.
                Purchases use your remembered envelopes; paychecks wait for you
                to distribute them.
              </p>
            </div>
            {snap.demo ? (
              <div className="notice">
                Bank connections aren’t available in the sample budget. Sign in
                to configure your real budget.
              </div>
            ) : banks && !banks.configured ? (
              <div className="notice">
                <strong>Bank sync needs setup</strong>
                <p>
                  Add your Plaid client ID, secret, and token-encryption key to
                  the Worker. Production access is required for real bank
                  accounts. See the project README.
                </p>
              </div>
            ) : (
              <>
                {banks?.environment === "sandbox" && (
                  <div className="notice">
                    Sandbox mode: connections use test data. Switch to approved
                    production credentials before linking real accounts.
                  </div>
                )}
                <div className="bank-toolbar">
                  <button
                    className="button primary"
                    disabled={
                      busy || !banks?.refreshEnabled || !refreshableBanks.length
                    }
                    title={
                      banks?.refreshEnabled
                        ? "Request a newer update from all supported banks"
                        : "Enable on-demand refresh after confirming provider pricing"
                    }
                    onClick={() =>
                      void run(async () => {
                        const result = await api("/api/banks/refresh-all", {});
                        setBanks(await api("/api/banks"));
                        if (result.requested)
                          onSaved(
                            `Refresh requested for ${result.requested} bank${result.requested === 1 ? "" : "s"}.`,
                          );
                        if (result.failed.length)
                          setError(
                            result.failed
                              .map(
                                (failure: { name: string; reason: string }) =>
                                  `${failure.name}: ${failure.reason}`,
                              )
                              .join(" "),
                          );
                      })
                    }
                  >
                    <RefreshCw size={16} /> Refresh all banks
                  </button>
                  <button
                    disabled={busy || !banks}
                    className="button secondary"
                    onClick={() => void run(() => linkBank())}
                  >
                    <Plus size={16} /> Add a bank
                  </button>
                </div>
                {banks?.connections?.map((b: any) => (
                  <div className="bank-connection" key={b.id}>
                    <div className="bank-row">
                      <Landmark size={21} />
                      <div>
                        <strong>{b.name}</strong>
                        <small>
                          {b.enabled
                            ? `${b.selectedAccountIds.length} account${b.selectedAccountIds.length === 1 ? "" : "s"} selected${b.synced ? " · Budget checked " + new Date(b.synced).toLocaleString() : ""}`
                            : "Paused · Choose accounts to start importing"}
                        </small>
                        {bankStatuses[b.id] && !bankStatuses[b.id].error && (
                          <small>
                            {bankStatuses[b.id].lastBankUpdate
                              ? `Plaid checked bank ${new Date(bankStatuses[b.id].lastBankUpdate!).toLocaleString()}`
                              : "Plaid bank check time unavailable"}
                            {bankStatuses[b.id].itemError
                              ? bankStatuses[b.id].itemError === "ITEM_LOGIN_REQUIRED"
                                ? " · Reconnect needed"
                                : ` · ${bankStatuses[b.id].itemError}`
                              : ""}
                          </small>
                        )}
                        {bankStatuses[b.id]?.error && (
                          <small>
                            Bank status unavailable: {bankStatuses[b.id].error}
                          </small>
                        )}
                        {bankStatuses[b.id] &&
                          !bankStatuses[b.id].error &&
                          !bankStatuses[b.id].webhookMatches && (
                            <div className="bank-actions">
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api("/api/banks/repair-webhook", {
                                      id: b.id,
                                    });
                                    const status = await api(
                                      `/api/banks/status?id=${encodeURIComponent(b.id)}`,
                                    );
                                    setBankStatuses((current) => ({
                                      ...current,
                                      [b.id]: status,
                                    }));
                                    onSaved("Bank notifications repaired.");
                                  })
                                }
                              >
                                Repair bank notifications
                              </button>
                            </div>
                          )}
                        {(b.error || bankNeedsReconnect(b)) && (
                          <p className="error">
                            {bankNeedsReconnect(b)
                              ? "This bank connection needs to reconnect before new transactions can arrive."
                              : b.error}
                          </p>
                        )}
                        <div className="bank-actions">
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void run(() => loadBankAccounts(b.id))
                            }
                          >
                            Choose accounts
                          </button>
                          <button
                            className={
                              bankNeedsReconnect(b)
                                ? "button primary"
                                : "text-button"
                            }
                            disabled={busy}
                            onClick={() => void run(() => linkBank(b.id))}
                          >
                            {bankNeedsReconnect(b)
                              ? "Reconnect this login"
                              : "Change bank access"}
                          </button>
                        </div>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Refresh ${b.name}`}
                        disabled={
                          busy ||
                          !b.enabled ||
                          !banks.refreshEnabled ||
                          /capital one/i.test(b.name)
                        }
                        title={
                          banks.refreshEnabled
                            ? "Request a newer bank update"
                            : "Enable on-demand refresh after confirming provider pricing"
                        }
                        onClick={() =>
                          void run(async () => {
                            await api("/api/banks/refresh", { id: b.id });
                            setBanks(await api("/api/banks"));
                            onSaved("Bank refresh requested");
                          })
                        }
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                    {bankAccounts[b.id] && (
                      <div className="bank-account-panel">
                        <p>
                          Choose only your personal accounts. Earlier purchases
                          are skipped. When the bank provides no purchase time,
                          transactions dated the connection day are also
                          skipped.
                        </p>
                        {bankAccounts[b.id].length ? (
                          bankAccounts[b.id].map((account) => (
                            <label
                              className="bank-account-choice"
                              key={account.id}
                            >
                              <input
                                type="checkbox"
                                checked={(accountChoices[b.id] || []).includes(
                                  account.id,
                                )}
                                onChange={(event) =>
                                  setAccountChoices((current) => ({
                                    ...current,
                                    [b.id]: event.target.checked
                                      ? [...(current[b.id] || []), account.id]
                                      : (current[b.id] || []).filter(
                                          (id) => id !== account.id,
                                        ),
                                  }))
                                }
                              />
                              <span>
                                <strong>
                                  {account.officialName || account.name}
                                </strong>
                                <small>
                                  {[
                                    account.subtype || account.type,
                                    account.mask ? `•••• ${account.mask}` : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </span>
                            </label>
                          ))
                        ) : (
                          <p>
                            No accounts are shared yet. Use Change bank access
                            to grant the personal account.
                          </p>
                        )}
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void run(() => saveBankAccounts(b.id))}
                        >
                          {accountChoices[b.id]?.length
                            ? "Save accounts and start sync"
                            : "Pause this connection"}
                        </button>
                        <small>
                          If your personal account is missing, use Change bank
                          access above, then choose it here.
                        </small>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}
        {tab === "data" && (
          <>
            <div className="settings-section">
              <h3>Your data goes with you</h3>
              <p>
                One CSV includes envelopes, transactions, tags, merchant rules,
                settings, and retained edit history. Unsynced edits are included
                as recovery records. Passwords and bank secrets are excluded.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void run(exportAll)}
              >
                <Download size={16} /> Export all data
              </button>
              {!snap.online && !snap.demo && (
                <small>
                  Offline exports include this device’s cached data and waiting
                  edits. The server’s edit history requires a connection.
                </small>
              )}
            </div>
            <div className="settings-section">
              <h3>Bring your budget home</h3>
              <p>
                Import a Goodbudget CSV with a preview, or restore a Public
                Budget export into an empty budget.
              </p>
              <label className="upload-zone">
                <Upload size={22} />
                <strong>Choose a CSV file</strong>
                <span>
                  Preview first. Your data stays in your browser until you
                  import.
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void run(() => loadFile(file));
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {table && mapping && (
              <>
                <h3>Match your columns</h3>
                <div className="mapping-grid">
                  {Object.keys(mapping).map((k) => (
                    <Field label={k} key={k}>
                      <Select
                        label={k}
                        value={mapping[k as keyof ImportMapping]}
                        onChange={(value) => {
                          setMapping({ ...mapping, [k]: value });
                          setPreview(undefined);
                          setImportConfirm(false);
                        }}
                        options={[
                          { value: "", label: "Not included" },
                          ...table.headers.map((h) => ({ value: h, label: h })),
                        ]}
                      />
                    </Field>
                  ))}
                </div>
                <div className="notice">
                  <strong>Check your export’s structure</strong>
                  <p>
                    Amount is interpreted as an expense unless the Type column
                    explicitly says income, deposit, or refund. Transfers,
                    fills, and splits require a matching import adapter and are
                    rejected for review. Envelope targets and current balances
                    often need a separate export or manual reconciliation.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() =>
                    setPreview(goodbudgetPreview(table.rows, mapping, batch))
                  }
                >
                  Preview {table.rows.length} rows
                  <ArrowRight size={15} />
                </button>
              </>
            )}
            {preview && (
              <div className="import-preview">
                <h3>
                  {
                    preview.records.filter((r) => r.kind === "transaction")
                      .length
                  }{" "}
                  transactions found
                </h3>
                <p>
                  {preview.records.filter((r) => r.kind === "envelope").length}{" "}
                  envelope names · {preview.errors.length} rows need attention
                </p>
                {preview.errors.length > 0 ? (
                  <div className="error">
                    <ul>
                      {preview.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                    <p>
                      No rows will be imported until every error is resolved.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="preview-table">
                      {preview.records
                        .filter((r) => r.kind === "transaction")
                        .slice(0, 6)
                        .map((r) => (
                          <div key={r.id}>
                            <span>{r.kind === "transaction" && r.payee}</span>
                            <span>{r.kind === "transaction" && r.type}</span>
                          </div>
                        ))}
                    </div>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={importConfirm}
                        onChange={(e) => setImportConfirm(e.target.checked)}
                      />{" "}
                      I checked the transaction types and amounts. I will
                      reconcile opening balances after import.
                    </label>
                    <button
                      className="button primary"
                      disabled={busy || !importConfirm}
                      onClick={() => void run(doImport)}
                    >
                      Import all rows
                    </button>
                  </>
                )}
              </div>
            )}
            {restore && (
              <div className="notice">
                <h3>Restore preview</h3>
                <p>
                  {envelopes(restore).length} envelopes ·{" "}
                  {transactions(restore).length} transactions. Restore is only
                  allowed into an empty budget.
                </p>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={importConfirm}
                    onChange={(e) => setImportConfirm(e.target.checked)}
                  />{" "}
                  Restore these records into this empty budget.
                </label>
                <button
                  className="button primary"
                  disabled={busy || !importConfirm}
                  onClick={() => void run(doImport)}
                >
                  Restore budget
                </button>
              </div>
            )}
          </>
        )}
        {tab === "devices" && (
          <>
            <div className="settings-intro">
              <ShieldCheck size={30} />
              <h3>A shared password. Your own devices.</h3>
              <p>
                Each phone has its own secure session. Revoking a session stops
                future server access; saved offline data stays on that device
                until cleared.
              </p>
            </div>
            {snap.demo ? (
              <div className="notice">
                Device management is available after signing in.
              </div>
            ) : (
              devices.map((d) => (
                <div className="device-row" key={d.hash}>
                  <div>
                    <strong>
                      {d.device}
                      {d.current ? " · this device" : ""}
                    </strong>
                    <small>
                      Signed in {new Date(d.created).toLocaleDateString()}
                    </small>
                  </div>
                  <button
                    className="text-button danger-text"
                    onClick={() => setRevoke(d.hash)}
                  >
                    Revoke
                  </button>
                </div>
              ))
            )}
            {revoke && (
              <div className="notice">
                <Field label="Confirm shared password to revoke access">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </Field>
                <button
                  className="button danger-button"
                  onClick={() =>
                    void run(async () => {
                      await revokeSession(revoke, password);
                      setRevoke("");
                      setPassword("");
                      setDevices((await api("/api/devices")).devices);
                      onSaved("Session revoked");
                    })
                  }
                >
                  Revoke session
                </button>
              </div>
            )}
            <button
              className="button secondary"
              onClick={() =>
                void run(async () => {
                  await logout();
                })
              }
            >
              <LogOut size={16} />
              {snap.demo
                ? "Leave sample budget"
                : "Sign out & clear this device"}
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {busy && (
          <p className="muted-text" role="status">
            Working on it…
          </p>
        )}
      </div>
    </section>
  );
}
