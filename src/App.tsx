import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { setAppUpdateBlocked } from "./lib/app-updates";
import ScreenTransition, {
  type NavigationMotion,
} from "./components/ScreenTransition";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Plus,
  ArrowLeft,
  SquarePen,
  Mail,
  Search,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  ChevronRight,
  Wallet,
  LayoutGrid,
  List,
  Settings2,
  RefreshCw,
  Cloud,
  CloudOff,
  Clock,
  ShoppingBasket,
  Utensils,
  Car,
  House,
  ShoppingBag,
  Zap,
  Plane,
  Landmark,
  ShieldCheck,
  ArrowRight,
  Check,
  Ellipsis,
  AlertCircle,
  LogOut,
  WifiOff,
  Leaf,
  Download,
} from "lucide-react";
import * as store from "./lib/store";
import {
  transactionDisplay,
  transactionTitle,
} from "./lib/transaction-display";
import {
  createBudgetIndex,
  filterTransactions,
  indexedRunningBalances,
  normalizeTag,
} from "./lib/budget-index";
import {
  moneyText,
  today,
  isLegacyDuplicateExclusion,
  type Transaction,
  type Envelope,
} from "../shared/model";
import EnvelopeIcon from "./components/EnvelopeIcon";
import TransactionForm from "./components/TransactionForm";
import TransactionFeed, {
  TRANSACTION_PAGE_SIZE,
} from "./components/TransactionFeed";
import PayeeLogo from "./components/PayeeLogo";
import { preloadPayeeLogos } from "./lib/preload-payee-logos";
import { tracksWeeklyPace, weeklySpendingPace } from "./lib/month-pace";
import EnvelopeWeeklyPace from "./components/EnvelopeWeeklyPace";
import Select from "./components/Select";
import TagFilter from "./components/TagFilter";
import EnvelopeManager from "./components/EnvelopeManager";
import RecordComparison from "./components/RecordComparison";
import SettingsPanel from "./components/SettingsPanel";
import { Modal } from "./components/ui";
import { exportCSV, download } from "./lib/csv";
import { isAutomaticTag } from "../shared/automatic-import";
const headerVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction * 14,
    scale: 0.94,
    filter: "blur(3px)",
  }),
  center: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)" },
  exit: (direction: number) => ({
    opacity: 0,
    x: -direction * 12,
    scale: 1.03,
    filter: "blur(3px)",
  }),
};
function Login({ onSuccess }: { onSuccess?: () => void } = {}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="login-page">
      <div className="login-layout">
        <div className="login-card">
          <h1>Sign in</h1>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await store.login(password);
                onSuccess?.();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Household password</span>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Your shared password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full-width" disabled={busy}>
              {busy ? "Signing in…" : "Open your budget"}
              <ArrowRight size={17} />
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
export default function App() {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const reducedMotion = useReducedMotion();
  const [navigation, setNavigation] = useState<NavigationMotion>({
    direction: 1,
    distance: 20,
  });
  const [tab, setTab] = useState<"envelopes" | "transactions" | "settings">(
    "envelopes",
  );
  const [selectedEnvelope, setSelectedEnvelope] = useState<string | null>(null);
  const envelopeListScroll = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [form, setForm] = useState<Transaction | "new" | null>(null);
  const [manage, setManage] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [toast, setToast] = useState("");
  const restoringDuplicates = useRef(false);
  const [paceNow, setPaceNow] = useState(() => new Date());
  const index = useMemo(
    () => (snap.view ? createBudgetIndex(snap.view) : undefined),
    [snap.view],
  );
  useEffect(() => {
    if (!snap.view || restoringDuplicates.current) return;
    const matches = Object.values(snap.view.records).filter(
      (record): record is Transaction =>
        record.kind === "transaction" && isLegacyDuplicateExclusion(record),
    );
    if (!matches.length) return;
    restoringDuplicates.current = true;
    void store
      .saveMany(
        matches.map((transaction) => ({
          ...transaction,
          excluded: false,
          needsReview: undefined,
          updatedAt: new Date().toISOString(),
        })),
        "Include previously excluded matching transactions",
      )
      .catch(() => setToast("Could not include older matching transactions"))
      .finally(() => {
        restoringDuplicates.current = false;
      });
  }, [snap.view]);
  const tagOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const transaction of index?.everyTransaction || [])
      for (const tag of transaction.tags) {
        const key = normalizeTag(tag);
        if (key && !isAutomaticTag(tag) && !names.has(key))
          names.set(key, tag.trim());
      }
    return [...names]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [index]);
  const list = useMemo(
    () =>
      index
        ? filterTransactions(
            index,
            selectedEnvelope,
            filter,
            query,
            selectedTags,
          )
        : [],
    [index, selectedEnvelope, filter, query, selectedTags],
  );
  const runningBalances = useMemo(
    () =>
      index && selectedEnvelope
        ? indexedRunningBalances(index, selectedEnvelope)
        : new Map<string, number>(),
    [index, selectedEnvelope],
  );
  useEffect(() => {
    // Warm the main tab before it is opened, plus the current envelope/search.
    // Fetch only a page of logos, never the full transaction history.
    preloadPayeeLogos(
      (index?.visible || [])
        .slice(0, TRANSACTION_PAGE_SIZE)
        .map((t) => t.payee),
    );
    preloadPayeeLogos(list.slice(0, TRANSACTION_PAGE_SIZE).map((t) => t.payee));
  }, [index, list]);
  useLayoutEffect(() => {
    if (pendingScroll.current === null) return;
    // Restore after the destination list is mounted, before it is painted.
    // Scrolling in the click handler uses the outgoing screen's height and
    // can clamp a saved list position when the envelope history is shorter.
    window.scrollTo({
      top: pendingScroll.current,
      left: 0,
      behavior: "instant",
    });
    pendingScroll.current = null;
  }, [tab, selectedEnvelope, navigation]);
  useEffect(() => {
    void store.boot();
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.ready.then(() => store.markOfflineReady());
  }, []);
  useLayoutEffect(() => {
    // Settings includes delayed autosaves, imports, and account setup flows.
    setAppUpdateBlocked(
      !!form || manage || reauth || syncOpen || tab === "settings",
    );
    return () => setAppUpdateBlocked(true);
  }, [form, manage, reauth, syncOpen, tab]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const refresh = () => setPaceNow(new Date());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (snap.phase === "loading")
    return (
      <div className="loading">
        <img src="/icon.svg" alt="Budget" />
        <span>Making room for what matters…</span>
      </div>
    );
  if (snap.phase === "login" || reauth)
    return (
      <>
        <Login onSuccess={() => setReauth(false)} />
        {reauth && (
          <button
            className="back-to-budget button"
            onClick={() => setReauth(false)}
          >
            Back to saved budget
          </button>
        )}
      </>
    );
  const state = snap.view!;
  const selected =
    selectedEnvelope && state.records[selectedEnvelope]?.kind === "envelope"
      ? (state.records[selectedEnvelope] as Envelope)
      : undefined;
  const headerKey = selected ? `envelope:${selected.id}` : tab;
  const headerTitle =
    selected?.name ||
    (tab === "envelopes"
      ? "Envelopes"
      : tab === "transactions"
        ? "Transactions"
        : "Settings");
  const headerTransition = {
    duration: reducedMotion ? 0 : 0.22,
    ease: [0.22, 1, 0.36, 1] as const,
  };
  const { active, bs, total, unallocated, pending, envelopeGroups } = index!;
  const dirty = new Set(
    snap.doc?.queue.flatMap((i) => i.op.patches.map((p) => p.record.id)),
  );
  function changeTab(next: "envelopes" | "transactions" | "settings") {
    pendingScroll.current =
      next === "envelopes" && selected ? envelopeListScroll.current : 0;
    const order = ["envelopes", "transactions", "settings"];
    setNavigation({
      direction: order.indexOf(next) <= order.indexOf(tab) ? -1 : 1,
      distance: selected ? 40 : 20,
    });
    setTab(next);
    setSelectedEnvelope(null);
    setQuery("");
    setFilter("all");
    setSearchOpen(false);
  }
  function openEnvelope(id: string) {
    if (!selected) envelopeListScroll.current = window.scrollY;
    pendingScroll.current = 0;
    setNavigation({ direction: 1, distance: 40 });
    setSelectedEnvelope(id);
    setQuery("");
    setFilter("all");
    setSearchOpen(false);
  }
  function envelopeRow(env: Envelope, detail = false) {
    const value = bs[env.id] || 0;
    const pct = env.target
      ? Math.max(0, Math.min(100, (value / env.target) * 100))
      : value > 0
        ? 100
        : 0;
    const weeklyPace = tracksWeeklyPace(env)
      ? weeklySpendingPace(env.target!, value, paceNow)
      : null;
    const expectedBalance = weeklyPace
      ? Math.round(weeklyPace.plannedForFutureWeeks)
      : null;
    const paceDescription =
      weeklyPace === null
        ? undefined
        : weeklyPace.futureWeeks === 0
          ? "Final week of the budget month; no later weeks remain."
          : `The line marks ${moneyText(expectedBalance!)} planned for the ${weeklyPace.futureWeeks} later ${weeklyPace.futureWeeks === 1 ? "week" : "weeks"}. This envelope is ${value >= expectedBalance! ? "ahead of" : "behind"} that pace by ${moneyText(Math.abs(value - expectedBalance!))}.`;
    return (
      <div
        className={"envelope-line " + (detail ? "envelope-detail-summary" : "")}
      >
        <div className="envelope-line-main">
          <span className="envelope-line-name">
            <EnvelopeIcon name={env.icon} />
            <span>{env.name}</span>
            {dirty.has(env.id) && <Clock size={13} aria-label="Not synced" />}
          </span>
          <div
            className={"progress-track " + (value < 0 ? "overdrawn" : "")}
            role="meter"
            aria-label={`${env.name} fullness`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-description={paceDescription}
            title={paceDescription}
          >
            <span className="progress-fill" style={{ width: `${pct}%` }} />
            {weeklyPace !== null && (
              <span
                className="progress-month-marker"
                style={{ left: `${weeklyPace.futureWeekPercent}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        <div className="envelope-line-values">
          <strong className={value < 0 ? "negative" : ""}>
            {moneyText(value)}
          </strong>
          <span>
            {env.target === null ? "No target" : moneyText(env.target)}
          </span>
        </div>
      </div>
    );
  }
  const uploading = snap.syncing && !!snap.doc?.queue.length;
  const isSynced =
    !snap.demo &&
    snap.online &&
    !snap.error &&
    !snap.doc?.queue.length &&
    !!snap.doc?.lastSync;
  const syncIcon = uploading ? (
    <RefreshCw size={14} className="spin" />
  ) : !snap.online ? (
    <CloudOff size={14} />
  ) : snap.doc?.queue.length ? (
    <Clock size={14} />
  ) : (
    <Cloud size={14} />
  );
  function txRow(t: Transaction) {
    const display = transactionDisplay(state, t, selected?.id);
    const title = transactionTitle(state, t);
    const firstUserTag = t.tags.find((tag) => !isAutomaticTag(tag));
    return (
      <button className="transaction-row" key={t.id} onClick={() => setForm(t)}>
        <PayeeLogo name={title} eager />
        <div className="transaction-title">
          <strong>{title}</strong>
          <span>
            {display.subtitle}
            {firstUserTag && <i> · {firstUserTag}</i>}
          </span>
        </div>
        <div className="transaction-flags">
          {t.pending && <span className="badge">Pending</span>}
          {dirty.has(t.id) && <Clock aria-label="Not synced" size={13} />}
        </div>
        <div
          className={
            "transaction-amount " +
            (display.incoming ? "positive" : "") +
            (t.excluded ? " excluded" : "")
          }
        >
          <strong>
            {display.sign}
            {moneyText(display.amount)}
          </strong>
          {selected && runningBalances.has(t.id) && (
            <small
              aria-label="Balance after transaction"
              className={
                runningBalances.get(t.id)! < 0 ? "negative-balance" : undefined
              }
            >
              {moneyText(runningBalances.get(t.id)!)}
            </small>
          )}
        </div>
        <ChevronRight className="row-chevron" size={15} />
      </button>
    );
  }
  return (
    <div className="app-shell">
      <header className="budget-header">
        <div className="budget-header-inner">
          <div className="header-leading">
            <AnimatePresence
              initial={false}
              custom={navigation.direction}
              mode="popLayout"
            >
              {selected ? (
                <motion.button
                  key="back"
                  className="header-control"
                  aria-label="Back to envelopes"
                  onClick={() => changeTab("envelopes")}
                  variants={headerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={headerTransition}
                >
                  <ArrowLeft size={22} />
                </motion.button>
              ) : tab === "envelopes" ? (
                <motion.button
                  key="edit"
                  className="header-control"
                  onClick={() => setManage(true)}
                  variants={headerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={headerTransition}
                >
                  Edit
                </motion.button>
              ) : tab === "transactions" ? (
                <motion.button
                  key="search"
                  className="header-control"
                  aria-label="Search transactions"
                  onClick={() => setSearchOpen((v) => !v)}
                  variants={headerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={headerTransition}
                >
                  <Search size={22} />
                </motion.button>
              ) : null}
            </AnimatePresence>
          </div>
          <h1 className="header-title-slot" aria-label={headerTitle}>
            <AnimatePresence initial={false} custom={navigation.direction}>
              <motion.span
                key={headerKey}
                aria-hidden="true"
                variants={headerVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={headerTransition}
              >
                {headerTitle}
              </motion.span>
            </AnimatePresence>
          </h1>
          <div className="header-trailing">
            <AnimatePresence
              initial={false}
              custom={navigation.direction}
              mode="popLayout"
            >
              {selected && (
                <motion.button
                  key="edit-envelope"
                  className="header-control"
                  aria-label="Edit envelope"
                  onClick={() => setManage(true)}
                  variants={headerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={headerTransition}
                >
                  <SlidersHorizontal size={19} />
                </motion.button>
              )}
            </AnimatePresence>
            <button
              className="header-control compose-control"
              aria-label="Create transaction"
              onClick={() => (active.length ? setForm("new") : setManage(true))}
            >
              <AnimatePresence
                initial={false}
                custom={navigation.direction}
                mode="popLayout"
              >
                <motion.span
                  key={headerKey}
                  className="compose-icon"
                  variants={headerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={headerTransition}
                >
                  <SquarePen size={23} />
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </header>
      {snap.demo && (
        <div className="demo-banner">
          <span>
            You’re exploring a sample budget. Changes stay on this device.
          </span>
          <button onClick={() => void store.exitDemo()}>
            Back to sign in <ArrowRight size={13} />
          </button>
        </div>
      )}
      {!snap.demo && (!snap.online || snap.error) && (
        <div className="connection-banner">
          <span>
            {snap.status}
            {snap.doc?.queue.length
              ? ` · ${snap.doc.queue.length} waiting change${snap.doc.queue.length === 1 ? "" : "s"}`
              : ""}
          </span>
          <button onClick={() => setSyncOpen(true)}>View details</button>
        </div>
      )}
      <main className="budget-content">
        <AnimatePresence initial={false} custom={navigation}>
          <ScreenTransition key={selected ? `envelope:${selected.id}` : tab}>
            {!selected && (
              <div className="budget-status-row">
                <button
                  className="sync-status"
                  onClick={() => setSyncOpen(true)}
                >
                  {!isSynced && syncIcon}
                  <span>
                    {snap.demo
                      ? "Sample budget"
                      : uploading
                        ? "Syncing…"
                        : snap.doc?.queue.length
                          ? `${snap.doc.queue.length} unsynced`
                          : !snap.online
                            ? "Offline"
                            : snap.error
                              ? "Sync issue"
                              : isSynced
                                ? "Synced"
                                : "Waiting to sync"}
                  </span>
                  {isSynced && <span className="tiny-dot" aria-hidden="true" />}
                </button>
                {tab === "envelopes" && (
                  <span>
                    All envelopes <strong>{moneyText(total)}</strong>
                  </span>
                )}
              </div>
            )}
            {unallocated.length > 0 && (
              <button
                className="attention-bar"
                onClick={() => {
                  changeTab("transactions");
                  setFilter("unallocated");
                  setSearchOpen(true);
                }}
              >
                <AlertCircle size={16} />
                <span>
                  {unallocated.length} income payment
                  {unallocated.length === 1 ? "" : "s"} to distribute
                </span>
                <ChevronRight size={16} />
              </button>
            )}
            {tab === "settings" ? (
              <SettingsPanel snapshot={snap} onSaved={setToast} />
            ) : tab === "envelopes" && !selected ? (
              <section className="envelope-sections">
                {[...envelopeGroups].map(([name, items]) => (
                  <section className="envelope-group" key={name}>
                    <div className="list-section-heading">
                      <h2>{name}</h2>
                      <strong>
                        {moneyText(
                          items.reduce((sum, e) => sum + (bs[e.id] || 0), 0),
                        )}
                      </strong>
                    </div>
                    {items.map((e) => (
                      <button
                        className="envelope-row-button"
                        key={e.id}
                        onClick={() => openEnvelope(e.id)}
                      >
                        {envelopeRow(e)}
                      </button>
                    ))}
                  </section>
                ))}
                {!active.length && (
                  <div className="empty-state">
                    <Mail size={28} />
                    <h3>Your envelopes</h3>
                    <p>Create an envelope, then add income to fill it.</p>
                  </div>
                )}
                <button
                  className="new-envelope-row"
                  onClick={() => setManage(true)}
                >
                  <Plus size={18} /> New envelope
                </button>
              </section>
            ) : (
              <section className="transactions-section">
                {selected && envelopeRow(selected, true)}
                {selected && tracksWeeklyPace(selected) && (
                  <EnvelopeWeeklyPace
                    target={selected.target!}
                    balance={bs[selected.id] || 0}
                    now={paceNow}
                    envelopeId={selected.id}
                    transactions={index!.byEnvelope.get(selected.id) || []}
                  />
                )}
                {(searchOpen ||
                  query ||
                  filter !== "all" ||
                  selectedTags.length > 0) && (
                  <div className="transaction-tools">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        autoFocus
                        placeholder="Search transactions…"
                        aria-label="Search transactions"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button
                          aria-label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          ×
                        </button>
                      )}
                    </label>
                    <div className="transaction-filter">
                      <Select
                        label="Filter transactions"
                        value={filter}
                        onChange={setFilter}
                        options={[
                          { value: "all", label: "All transactions" },
                          { value: "expense", label: "Expenses" },
                          { value: "income", label: "Income" },
                          { value: "unallocated", label: "Unallocated income" },
                          {
                            value: "pending",
                            label: `Pending (${pending.length})`,
                          },
                          {
                            value: "including-excluded",
                            label: "Include excluded",
                          },
                          { value: "deleted", label: "Deleted transactions" },
                        ]}
                      />
                    </div>
                    <TagFilter
                      options={tagOptions}
                      selected={selectedTags}
                      onChange={setSelectedTags}
                    />
                  </div>
                )}
                <TransactionFeed
                  key={JSON.stringify([
                    tab,
                    selectedEnvelope,
                    query,
                    filter,
                    selectedTags,
                  ])}
                  transactions={list}
                  renderRow={txRow}
                />
                {!list.length && (
                  <div className="empty-state">
                    <List size={28} />
                    <h3>
                      {query || selectedTags.length
                        ? "No matching transactions"
                        : "No transactions yet"}
                    </h3>
                    <p>
                      {query || selectedTags.length
                        ? "Try a payee, note, tag, or envelope."
                        : "Your transactions will appear here, grouped by day."}
                    </p>
                  </div>
                )}
              </section>
            )}
          </ScreenTransition>
        </AnimatePresence>
      </main>
      <nav
        className="budget-nav"
        aria-label="Budget navigation"
        data-active-tab={tab}
      >
        <span className="budget-nav-indicator" aria-hidden="true" />
        <button
          className={tab === "envelopes" ? "active" : ""}
          aria-current={tab === "envelopes" ? "page" : undefined}
          onClick={() => changeTab("envelopes")}
        >
          <Mail size={22} />
          <span>Envelopes</span>
        </button>
        <button
          className={tab === "transactions" ? "active" : ""}
          aria-current={tab === "transactions" ? "page" : undefined}
          onClick={() => changeTab("transactions")}
        >
          <List size={23} />
          <span>Transactions</span>
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          aria-current={tab === "settings" ? "page" : undefined}
          onClick={() => changeTab("settings")}
        >
          <Settings2 size={22} />
          <span>Settings</span>
        </button>
      </nav>
      <AnimatePresence>
        {form && (
          <TransactionForm
            key={form === "new" ? "new" : form.id}
            state={state}
            initial={form === "new" ? undefined : form}
            preferredEnvelopeId={
              form === "new" && selected && !selected.archived
                ? selected.id
                : undefined
            }
            onClose={() => setForm(null)}
            onSaved={setToast}
          />
        )}
        {manage && (
          <EnvelopeManager
            key="envelope-manager"
            state={state}
            initialId={selected?.id}
            onArchived={() => changeTab("envelopes")}
            onClose={() => setManage(false)}
            onSaved={setToast}
          />
        )}
        {syncOpen && (
          <Modal
            key="sync"
            title={
              snap.demo
                ? "Saved on this device"
                : snap.doc?.queue.some((item) => item.conflict)
                  ? "Changes need review"
                  : snap.error
                    ? "Sync needs attention"
                    : snap.doc?.queue.length
                      ? snap.syncing
                        ? "Syncing changes…"
                        : "Changes waiting to sync"
                      : "Everything in sync"
            }
            subtitle={
              snap.demo
                ? "This sample budget is stored only on this device."
                : snap.status
            }
            onClose={() => setSyncOpen(false)}
          >
            <div className="form-body">
              <div className="sync-detail">
                <span>{syncIcon}</span>
                <div>
                  <strong>
                    {snap.demo
                      ? "Sample budget"
                      : snap.doc?.queue.length
                        ? `${snap.doc.queue.length} changes waiting`
                        : "Your changes are saved"}
                  </strong>
                  <p>
                    {snap.demo
                      ? "Sign in to share your real budget between phones."
                      : snap.doc?.lastSync
                        ? "Last synced " +
                          new Date(snap.doc.lastSync).toLocaleString()
                        : "This device hasn’t synced yet."}
                  </p>
                </div>
              </div>
              <p className="muted-text">
                {snap.readyOffline
                  ? "Available offline on this device. "
                  : "Preparing offline access on this device. "}
                On iPhone, reopen the app when you have a connection to finish
                syncing. Keep this device’s website data to preserve offline
                changes.
              </p>
              {snap.error && <p className="error">{snap.error}</p>}
              {snap.doc?.queue.map((i) => (
                <div className="queued-item" key={i.op.id}>
                  <strong>{i.op.label}</strong>
                  <small>
                    {i.error || "Saved here. Waiting for the shared budget."}
                  </small>
                  {i.conflict && (
                    <>
                      <details>
                        <summary>Compare this change</summary>
                        {i.op.patches.map((p) => (
                          <div
                            className="conflict-comparison"
                            key={p.record.id}
                          >
                            <div>
                              <small>Your saved version</small>
                              <RecordComparison
                                record={p.record}
                                state={state}
                              />
                            </div>
                            <div>
                              <small>Shared version</small>
                              <RecordComparison
                                record={snap.doc?.base.records[p.record.id]}
                                state={snap.doc!.base}
                              />
                            </div>
                          </div>
                        ))}
                      </details>
                      <div className="button-row">
                        <button
                          className="button small"
                          onClick={() =>
                            void store
                              .resolve(i.op.id, true)
                              .catch((e) => setToast(e.message))
                          }
                        >
                          Keep my version
                        </button>
                        <button
                          className="text-button"
                          onClick={() => void store.resolve(i.op.id, false)}
                        >
                          Keep shared version
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={snap.syncing || snap.demo}
                  onClick={() => void store.sync()}
                >
                  <RefreshCw size={15} /> Sync now
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    download(
                      exportCSV(
                        snap.doc!.base,
                        snap.doc!.queue.map((i) => i.op),
                      ),
                      `budget-recovery-${today()}.csv`,
                    )
                  }
                >
                  <Download size={15} /> Save recovery CSV
                </button>
              </div>
              {snap.status === "Sign in to sync" && (
                <button
                  className="text-button"
                  onClick={() => {
                    setSyncOpen(false);
                    setReauth(true);
                  }}
                >
                  Sign in again
                </button>
              )}
              {snap.error?.includes("generation changed") && (
                <button
                  className="button secondary"
                  onClick={() => {
                    download(
                      exportCSV(
                        snap.doc!.base,
                        snap.doc!.queue.map((i) => i.op),
                      ),
                      `budget-before-restore-${today()}.csv`,
                    );
                    void store
                      .loadRestoredBudget()
                      .then(() => setSyncOpen(false))
                      .catch((e) => setToast(e.message));
                  }}
                >
                  Export local copy & load restored budget
                </button>
              )}
            </div>
          </Modal>
        )}
      </AnimatePresence>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
