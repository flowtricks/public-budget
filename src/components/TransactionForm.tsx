import { useState, useLayoutEffect, useMemo, useRef } from "react";
import {
  Plus,
  X,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Trash2,
  Check,
  Info,
} from "lucide-react";
import { Modal, Field, DatePicker, Combo } from "./ui";
import Select from "./Select";
import PayeeLogo from "./PayeeLogo";
import CardSource from "./CardSource";
import TagPicker from "./TagPicker";
import {
  amountText,
  balances,
  cents,
  defaultEnvelope,
  envelopes,
  moneyText,
  settings,
  today,
  transactions,
  transactionPatches,
  type State,
  type Transaction,
} from "../../shared/model";
import { save } from "../lib/store";
import { recentTransactionPayees } from "../lib/recent-payees";
import { normalizeTag } from "../lib/budget-index";
import {
  fiveWeekFundingAmount,
  projectedEnvelopeTotal,
} from "../lib/envelope-funding";
import { withoutAutomaticTag } from "../../shared/automatic-import";
export default function TransactionForm({
  state,
  initial,
  preferredEnvelopeId,
  onClose,
  onSaved,
}: {
  state: State;
  initial?: Transaction;
  preferredEnvelopeId?: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const envelopeOverridden = useRef(false);
  const [isRefund, setIsRefund] = useState(false);
  const active = envelopes(state).filter((e) => !e.archived);
  const bs = balances(state);
  const [type, setType] = useState<Transaction["type"]>(
    initial?.type || "expense",
  );
  const [payee, setPayee] = useState(initial?.payee || "");
  const [amount, setAmount] = useState(
    initial ? amountText(initial.amount) : "",
  );
  const [date, setDate] = useState(
    initial?.date || today(settings(state).timezone),
  );
  const [note, setNote] = useState(initial?.note || "");
  useLayoutEffect(() => {
    const textarea = noteRef.current;
    if (!textarea) return;
    const fit = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fit();
    const frame = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
    };
  }, [note]);
  const [tags, setTags] = useState(withoutAutomaticTag(initial?.tags || []));
  const [tagDraft, setTagDraft] = useState("");
  const tagOptions = useMemo(
    () =>
      transactions(state).flatMap((transaction) =>
        withoutAutomaticTag(transaction.tags),
      ),
    [state],
  );
  const [allocs, setAllocs] = useState(() => {
    const saved = initial?.allocations.map((a) => ({
      id: a.envelopeId,
      amount: amountText(Math.abs(a.amount)),
      negative: a.amount < 0,
    }));
    if (initial?.type === "transfer" && saved) {
      const from = saved.find((a) => a.negative);
      const to = saved.find((a) => !a.negative);
      if (from && to) return [from, to];
    }
    return (
      saved || [
        {
          id: preferredEnvelopeId || settings(state).fallbackId,
          amount: "",
          negative: true,
        },
      ]
    );
  });
  const [cover, setCover] = useState(
    initial?.type === "income"
      ? initial.allocations.find((a) => a.amount < 0)?.envelopeId || ""
      : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [excludeFromBudget, setExcludeFromBudget] = useState(
    !!initial?.excluded,
  );
  const excluded = !isRefund && excludeFromBudget;
  const parse = (v: string) => {
    try {
      return cents(v || "0");
    } catch {
      return 0;
    }
  };
  const total = parse(amount);
  const incomeAllocs = allocs.filter((a) => !a.negative && a.id);
  const distributed = incomeAllocs.reduce((n, a) => n + parse(a.amount), 0);
  const remainder =
    type === "income"
      ? total - distributed
      : total - allocs.reduce((n, a) => n + parse(a.amount), 0);
  function changeType(t: Transaction["type"]) {
    setType(t);
    setAllocs(
      t === "income"
        ? []
        : t === "transfer"
          ? [
              { id: active[0]?.id || "", amount: "", negative: true },
              { id: active[1]?.id || "", amount: "", negative: false },
            ]
          : [
              {
                id: preferredEnvelopeId || settings(state).fallbackId,
                amount: "",
                negative: true,
              },
            ],
    );
    setPayee("");
    setCover("");
  }
  function choosePayee(v: string) {
    if (
      type === "expense" &&
      !isRefund &&
      !preferredEnvelopeId &&
      !envelopeOverridden.current
    )
      setAllocs((current) =>
        current.length === 1
          ? [{ ...current[0], id: defaultEnvelope(state, v) }]
          : current,
      );
    amountRef.current?.focus();
  }
  function setIncome(id: string, value: string) {
    setAllocs((a) => [
      ...a.filter((x) => x.id !== id),
      { id, amount: value, negative: false },
    ]);
  }
  function fillAll(mode: "add" | "topup") {
    setAllocs(
      active
        .filter((e) => e.target !== null)
        .map((e) => ({
          id: e.id,
          amount: amountText(
            mode === "topup"
              ? Math.max(0, e.target! - (bs[e.id] || 0))
              : e.target!,
          ),
          negative: false,
        })),
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (total <= 0) throw new Error("Enter an amount greater than zero.");
      let allocations: { envelopeId: string; amount: number }[];
      if (excluded) {
        allocations = [];
      } else if (type === "income") {
        allocations = incomeAllocs
          .map((a) => ({ envelopeId: a.id, amount: cents(a.amount || "0") }))
          .filter((a) => a.amount !== 0);
        if (remainder < 0 && cover) {
          if (allocations.some((a) => a.envelopeId === cover))
            throw new Error(
              "Choose a source envelope that is not receiving a fill.",
            );
          allocations.push({ envelopeId: cover, amount: remainder });
        }
        if (allocations.reduce((n, a) => n + a.amount, 0) !== total)
          throw new Error(
            remainder > 0
              ? "Assign the remaining income to an envelope."
              : "Choose an envelope to cover the shortfall.",
          );
      } else if (type === "transfer") {
        if (!allocs[0]?.id || !allocs[1]?.id)
          throw new Error("Choose both envelopes.");
        if (allocs[0]?.id === allocs[1]?.id)
          throw new Error("Choose two different envelopes.");
        allocations = [
          { envelopeId: allocs[0]?.id, amount: -total },
          { envelopeId: allocs[1]?.id, amount: total },
        ];
      } else
        allocations = allocs.map((a) => ({
          envelopeId: a.id,
          amount:
            (type === "expense" || (type === "adjustment" && a.negative)
              ? -1
              : 1) * (allocs.length === 1 ? total : cents(a.amount || "0")),
        }));
      const nextTags = [...tags, tagDraft.trim()].filter(Boolean);
      const seenTags = new Set<string>();
      const tx: Transaction = {
        ...(isRefund ? {} : initial),
        id: (!isRefund && initial?.id) || crypto.randomUUID(),
        kind: "transaction",
        version: (!isRefund && initial?.version) || 0,
        type,
        payee:
          type === "transfer"
            ? initial?.type === "transfer"
              ? initial.payee
              : "Envelope transfer"
            : payee.trim(),
        amount: total,
        date,
        note,
        tags: withoutAutomaticTag(
          nextTags.filter((tag) => {
            const key = normalizeTag(tag);
            if (seenTags.has(key)) return false;
            seenTags.add(key);
            return true;
          }),
        ),
        allocations,
        pending: (!isRefund && initial?.pending) || false,
        deleted: false,
        excluded,
        source: isRefund ? "manual" : initial?.source || "manual",
        needsReview: undefined,
        updatedAt: new Date().toISOString(),
        ...(isRefund ? { relatedTransactionId: initial?.id } : {}),
        ...(!isRefund && initial?.source === "bank"
          ? {
              bankOriginal: { ...initial.bankOriginal, edited: true },
              needsReview: undefined,
            }
          : {}),
      };
      const patches = transactionPatches(state, tx);
      if (isRefund)
        for (const a of allocations) {
          const env = state.records[a.envelopeId];
          if (env?.kind === "envelope" && env.archived)
            patches.push({ ...env, archived: false });
        }
      await save(patches, `${initial ? "Edit" : "Add"} ${type}: ${tx.payee}`);
      onClose();
      onSaved(initial ? "Transaction updated" : "Transaction saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      requestAnimationFrame(() =>
        errorRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!initial) return;
    try {
      await save(
        [
          {
            ...initial,
            deleted: true,
            ...(initial.source === "bank"
              ? {
                  bankOriginal: {
                    ...initial.bankOriginal,
                    removedByBank: false,
                  },
                }
              : {}),
            updatedAt: new Date().toISOString(),
          },
        ],
        `Delete ${initial.payee}`,
      );
      onSaved("Transaction deleted");
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }
  const allPayees = recentTransactionPayees(
    state,
    type === "income" ? "income" : "expense",
  );
  return (
    <Modal
      title={
        isRefund
          ? "Record a refund"
          : initial?.deleted
            ? "Restore transaction"
            : initial
              ? "Edit transaction"
              : "Add transaction"
      }
      onClose={onClose}
      wide
      className="transaction-sheet"
      initialFocus={initial ? undefined : '[aria-label="Payee"]'}
      action={
        <button
          className="header-save"
          type="button"
          onClick={() => formRef.current?.requestSubmit()}
          disabled={busy || !active.length}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      }
    >
      <form ref={formRef} onSubmit={submit}>
        <div className="form-body structured-form">
          {error && (
            <p ref={errorRef} role="alert" className="error save-error">
              {error}
            </p>
          )}
          <section className="form-row-group type-row-group">
            <Field label="Type">
              <Select<Transaction["type"]>
                label="Transaction type"
                value={type}
                disabled={isRefund}
                onChange={changeType}
                options={[
                  { value: "expense", label: "Expense" },
                  { value: "income", label: "Add income" },
                  { value: "transfer", label: "Envelope transfer" },
                  ...(type === "refund"
                    ? [{ value: "refund" as const, label: "Refund" }]
                    : []),
                  ...(type === "adjustment"
                    ? [{ value: "adjustment" as const, label: "Adjustment" }]
                    : []),
                ]}
              />
            </Field>
          </section>
          <section className="form-row-group">
            {type !== "transfer" && (
              <Field label={type === "income" ? "Payer" : "Payee"}>
                <Combo
                  id="payees"
                  label={type === "income" ? "Payer" : "Payee"}
                  value={payee}
                  onChange={setPayee}
                  onSelect={choosePayee}
                  options={allPayees}
                  renderOption={(option) => <PayeeLogo name={option} />}
                  placeholder={
                    type === "income"
                      ? "Who paid you?"
                      : "Who received payment?"
                  }
                />
              </Field>
            )}
            <Field label="Amount">
              <input
                ref={amountRef}
                aria-label="Amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </Field>
          </section>
          {initial?.source === "bank" && !isRefund && (
            <label className="check-row bank-budget-exclusion">
              <input
                type="checkbox"
                checked={excludeFromBudget}
                onChange={(event) =>
                  setExcludeFromBudget(event.target.checked)
                }
              />
              <span>
                Exclude from budget
                <small>
                  Use for credit card payments and transfers between your
                  accounts.
                </small>
              </span>
            </label>
          )}
          {excluded ? (
            <p className="bank-budget-exclusion-note">
              This transaction will not change your envelope balances.
            </p>
          ) : type === "income" ? (
            <section className="allocation-section">
              <div className="section-heading">
                <div>
                  <h3>Fill envelopes</h3>
                  <small>Choose full or custom amounts.</small>
                </div>
              </div>
              <div className="income-global-actions">
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => fillAll("add")}
                >
                  Add full amounts
                </button>
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => fillAll("topup")}
                >
                  Top up to full
                </button>
              </div>
              <div className="income-list">
                {active.map((env) => {
                  const balance = bs[env.id] || 0;
                  const addition =
                    incomeAllocs.find((a) => a.id === env.id)?.amount || "";
                  const newTotal = projectedEnvelopeTotal(
                    balance,
                    env.id,
                    remainder < 0 && cover === env.id
                      ? amountText(remainder)
                      : addition,
                    isRefund ? undefined : initial,
                    excluded,
                  );
                  const fiveWeekAmount = fiveWeekFundingAmount(env);
                  const fillAmount =
                    env.target === null ? 0 : Math.max(0, env.target - balance);
                  return (
                    <div className="income-row" key={env.id}>
                      <div className="income-row-info">
                        <strong>{env.name}</strong>
                        {env.target !== null && (
                          <small className="income-row-budget">
                            Budget {moneyText(env.target)}
                          </small>
                        )}
                      </div>
                      <div className="currency-field">
                        <span>$</span>
                        <input
                          aria-label={`Add to ${env.name}`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={addition}
                          onChange={(e) => setIncome(env.id, e.target.value)}
                        />
                      </div>
                      <output
                        className="income-row-preview"
                        aria-label={`Balance preview for ${env.name}`}
                      >
                        <span className="income-balance-current">
                          <span>Available</span> <b>{moneyText(balance)}</b>
                        </span>
                        {(newTotal === null || newTotal !== balance) && (
                          <>
                            <ArrowRight size={13} aria-hidden="true" />
                            <span className="income-balance-next">
                              <span>New total</span>{" "}
                              <b>
                                {newTotal === null ? "—" : moneyText(newTotal)}
                              </b>
                            </span>
                          </>
                        )}
                      </output>
                      {env.target !== null && (
                        <div className="income-row-actions">
                          <button
                            type="button"
                            className="button small secondary"
                            aria-label={`Add budget amount to ${env.name}`}
                            onClick={() =>
                              setIncome(env.id, amountText(env.target!))
                            }
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            className="button small secondary"
                            aria-label={`Fill ${env.name} to its budget amount`}
                            disabled={fillAmount === 0}
                            onClick={() =>
                              setIncome(env.id, amountText(fillAmount))
                            }
                          >
                            Fill
                          </button>
                          {fiveWeekAmount !== null && (
                            <button
                              type="button"
                              className="button small secondary"
                              aria-label={`Add 5 weeks to ${env.name}`}
                              // Intentionally available in every month for testing.
                              // Apply the five-week-month restriction after testing.
                              onClick={() =>
                                setIncome(env.id, amountText(fiveWeekAmount))
                              }
                            >
                              Add 5 weeks
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div
                className={
                  "allocation-total " + (remainder < 0 ? "warning" : "")
                }
              >
                <span>
                  {remainder < 0 ? "Shortfall to cover" : "Left to assign"}
                </span>
                <strong>{moneyText(Math.abs(remainder))}</strong>
              </div>
              {remainder < 0 && (
                <Field label="Move existing money from">
                  <Select
                    label="Move existing money from"
                    searchable
                    value={cover}
                    onChange={setCover}
                    options={[
                      { value: "", label: "Choose an envelope" },
                      ...active
                        .filter(
                          (e) =>
                            !incomeAllocs.some(
                              (a) => a.id === e.id && parse(a.amount) > 0,
                            ),
                        )
                        .map((e) => ({
                          value: e.id,
                          label: e.name,
                          detail: moneyText(bs[e.id] || 0),
                        })),
                    ]}
                  />
                  {cover && (
                    <small>
                      {moneyText((bs[cover] || 0) + remainder)} will remain.
                      This moves money; it doesn't create income.
                    </small>
                  )}
                </Field>
              )}
            </section>
          ) : type === "transfer" ? (
            <div className="form-grid">
              {["From envelope", "To envelope"].map((label, i) => (
                <Field label={label} key={label}>
                  <Select
                    label={label}
                    searchable
                    value={allocs[i]?.id || ""}
                    onChange={(id) =>
                      setAllocs((a) =>
                        a.map((v, j) => (j === i ? { ...v, id } : v)),
                      )
                    }
                    options={[
                      { value: "", label: "Choose an envelope" },
                      ...envelopes(state)
                        .filter(
                          (env) => !env.archived || env.id === allocs[i]?.id,
                        )
                        .map((env) => ({
                          value: env.id,
                          label: env.archived
                            ? `${env.name} (archived)`
                            : env.name,
                          detail: moneyText(bs[env.id] || 0),
                        })),
                    ]}
                  />
                </Field>
              ))}
            </div>
          ) : (
            <section
              className={
                "allocation-section expense-envelopes " +
                (allocs.length === 1 ? "single-envelope " : "") +
                (type === "refund" ? "refund-envelope" : "")
              }
            >
              <div className="section-heading">
                <h3>
                  {allocs.length > 1 ? "Split between envelopes" : "Envelope"}
                </h3>
              </div>
              {allocs.map((a, i) => (
                <div className="split-row" key={i}>
                  <Select
                    label={`Envelope ${i + 1}`}
                    searchable
                    value={a.id}
                    onChange={(id) => {
                      envelopeOverridden.current = true;
                      setAllocs((v) =>
                        v.map((x, j) => (j === i ? { ...x, id } : x)),
                      );
                    }}
                    options={[
                      { value: "", label: "Choose envelope" },
                      ...envelopes(state)
                        .filter((e) => !e.archived || e.id === a.id)
                        .map((e) => ({
                          value: e.id,
                          label: e.name,
                          detail: moneyText(bs[e.id] || 0),
                        })),
                    ]}
                  />
                  {allocs.length > 1 && (
                    <>
                      <div className="currency-field">
                        <span>$</span>
                        <input
                          aria-label={`Split amount ${i + 1}`}
                          inputMode="decimal"
                          value={a.amount}
                          onChange={(e) =>
                            setAllocs((v) =>
                              v.map((x, j) =>
                                j === i ? { ...x, amount: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove split ${i + 1}`}
                        onClick={() => {
                          envelopeOverridden.current = true;
                          setAllocs((a) => a.filter((_, j) => j !== i));
                        }}
                      >
                        <X size={15} />
                      </button>
                      <button
                        type="button"
                        className="remainder-button"
                        onClick={() =>
                          setAllocs((v) =>
                            v.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    amount: amountText(
                                      Math.max(
                                        0,
                                        total -
                                          v.reduce(
                                            (n, y, k) =>
                                              n +
                                              (k === i ? 0 : parse(y.amount)),
                                            0,
                                          ),
                                      ),
                                    ),
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        Use remaining
                      </button>
                    </>
                  )}
                </div>
              ))}
              {type === "refund" && (
                <p className="refund-envelope-hint">
                  <Info size={16} aria-hidden="true" />
                  <span>Refunds add money back to the selected envelope.</span>
                </p>
              )}
              <button
                type="button"
                className="text-button split-add-button"
                onClick={() => {
                  envelopeOverridden.current = true;
                  setAllocs((a) => [
                    ...a.map((v) =>
                      a.length === 1 ? { ...v, amount: amountText(total) } : v,
                    ),
                    {
                      id:
                        active.find((e) => !a.some((v) => v.id === e.id))?.id ||
                        "",
                      amount: "",
                      negative: true,
                    },
                  ]);
                }}
              >
                <Plus size={14} />{" "}
                {type === "refund" ? "Split refund" : "Split expense"}
              </button>
              {allocs.length > 1 && (
                <div
                  className={
                    "allocation-total " + (remainder !== 0 ? "warning" : "")
                  }
                >
                  <span>{remainder < 0 ? "Overallocated" : "Remaining"}</span>
                  <strong>{moneyText(Math.abs(remainder))}</strong>
                </div>
              )}
            </section>
          )}
          <div className="form-section-label">Details</div>
          {initial?.source === "bank" && !isRefund && (
            <CardSource transaction={initial} />
          )}
          <section className="form-row-group">
            <Field label="Date">
              <DatePicker value={date} onChange={setDate} />
            </Field>
            <Field label="Note">
              <textarea
                className="transaction-note"
                ref={noteRef}
                rows={1}
                placeholder="Optional"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <div className="field tag-field">
              <label htmlFor="transaction-tags">Tags</label>
              <TagPicker
                selected={tags}
                draft={tagDraft}
                options={tagOptions}
                onChange={setTags}
                onDraftChange={setTagDraft}
              />
            </div>
          </section>
          {initial?.type === "expense" && !initial.deleted && !isRefund && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setIsRefund(true);
                setDate(today(settings(state).timezone));
                setType("refund");
                setNote("Refund for " + initial.payee);
              }}
            >
              Record a refund for this purchase
            </button>
          )}
          {deleteConfirm && (
            <div className="notice danger">
              <p>Delete this transaction and reverse its envelope changes?</p>
              <button
                type="button"
                className="button danger-button"
                onClick={remove}
              >
                Yes, delete transaction
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setDeleteConfirm(false)}
              >
                Keep it
              </button>
            </div>
          )}
        </div>
        {initial && !isRefund && !initial.deleted && (
          <div className="transaction-delete-footer">
            <button
              type="button"
              className="delete-round"
              aria-label="Delete transaction"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 size={23} />
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
