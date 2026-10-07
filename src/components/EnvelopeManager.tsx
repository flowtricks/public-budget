import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  GripVertical,
  Plus,
  Minus,
  Undo2,
  ChevronRight,
  Archive,
} from "lucide-react";
import EnvelopeIcon from "./EnvelopeIcon";
import IconPicker from "./IconPicker";
import { Modal, Field, Combo } from "./ui";
import Select from "./Select";
import {
  envelopes,
  balances,
  settings,
  cents,
  amountText,
  moneyText,
  type State,
  type Envelope,
  type BudgetRecord,
  type Transaction,
  today,
} from "../../shared/model";
import { save } from "../lib/store";
type DropTarget = { id: string; side: "before" | "after" };
type DragSession = {
  id: string;
  group: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  grabY: number;
  active: boolean;
};
type DragPreview = { id: string; left: number; width: number; height: number };
export default function EnvelopeManager({
  state,
  initialId,
  onClose,
  onSaved,
  onArchived,
}: {
  state: State;
  initialId?: string;
  onClose: () => void;
  onSaved: (s: string) => void;
  onArchived?: () => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listScroll = useRef(0);
  const restoreFrame = useRef<number | undefined>(undefined);
  const restoreList = useCallback((list: HTMLDivElement | null) => {
    listRef.current = list;
    if (restoreFrame.current !== undefined)
      cancelAnimationFrame(restoreFrame.current);
    // Wait until the animated screen replacement finishes its DOM updates.
    if (list)
      restoreFrame.current = requestAnimationFrame(() => {
        const dialog = list.closest("dialog");
        if (dialog) dialog.scrollTop = listScroll.current;
      });
  }, []);
  const [items, setItems] = useState(envelopes(state));
  const [draft, setDraft] = useState<Envelope | undefined>(
    initialId ? (state.records[initialId] as Envelope) : undefined,
  );
  const [target, setTarget] = useState(
    initialId
      ? (state.records[initialId] as Envelope).target === null
        ? ""
        : amountText((state.records[initialId] as Envelope).target!)
      : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<string>();
  const [destination, setDestination] = useState("");
  const [defaultId, setDefault] = useState(settings(state).fallbackId);
  const [dragPreview, setDragPreview] = useState<DragPreview>();
  const dragPreviewRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const dropTargetRef = useRef<DropTarget | undefined>(undefined);
  const dragSession = useRef<DragSession | undefined>(undefined);
  const autoScrollFrame = useRef<number | undefined>(undefined);
  const [reorderMessage, setReorderMessage] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  useLayoutEffect(() => {
    if (archive) formRef.current?.closest("dialog")?.scrollTo(0, 0);
  }, [archive]);
  useLayoutEffect(() => {
    if (dragPreview) updateDragPreview();
  }, [dragPreview]);
  useEffect(
    () => () => {
      if (autoScrollFrame.current !== undefined)
        cancelAnimationFrame(autoScrollFrame.current);
    },
    [],
  );
  const initialBalances = balances(state);
  const bs = { ...initialBalances };
  for (const item of items)
    bs[item.id] =
      (bs[item.id] || 0) +
      item.opening -
      ((state.records[item.id] as Envelope)?.opening || 0);
  function open(item: Envelope) {
    listScroll.current = listRef.current?.closest("dialog")?.scrollTop ?? 0;
    setDraft({ ...item });
    setTarget(item.target === null ? "" : amountText(item.target));
    setError("");
  }
  function openArchived(event: React.MouseEvent<HTMLButtonElement>) {
    const dialog = event.currentTarget.closest("dialog");
    listScroll.current = dialog?.scrollTop ?? 0;
    setShowArchived(true);
    requestAnimationFrame(() => {
      if (dialog) dialog.scrollTop = 0;
    });
  }
  function add() {
    open({
      id: crypto.randomUUID(),
      version: 0,
      kind: "envelope",
      name: "",
      target: 0,
      weeklyPaceEnabled: true,
      fiveWeekFundingEnabled: false,
      opening: 0,
      icon: "wallet",
      color: "green",
      order: items.length,
      archived: false,
      group: "",
    });
  }
  function move(id: string, targetId: string, side: "before" | "after") {
    setItems((list) => {
      const from = list.findIndex((e) => e.id === id);
      const target = list.findIndex((e) => e.id === targetId);
      if (from < 0 || target < 0 || id === targetId) return list;
      let to = target + (side === "after" ? 1 : 0);
      if (from < to) to--;
      if (from === to) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }
  function setDrop(next?: DropTarget) {
    if (
      dropTargetRef.current?.id === next?.id &&
      dropTargetRef.current?.side === next?.side
    )
      return;
    dropTargetRef.current = next;
    setDropTarget(next);
  }
  function updateDragPreview() {
    const session = dragSession.current;
    const list = listRef.current;
    const preview = dragPreviewRef.current;
    if (!session?.active || !list || !preview) return;
    const top = session.y - list.getBoundingClientRect().top - session.grabY;
    preview.style.transform = `translate3d(0, ${top}px, 0)`;
  }
  function updateDrop(x: number, y: number) {
    const session = dragSession.current;
    const list = listRef.current;
    const dialog = list?.closest("dialog");
    if (!session || !list || !dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    ) {
      setDrop();
      return;
    }
    const rows = Array.from(
      list.querySelectorAll<HTMLElement>(".budget-edit-row"),
    ).filter((row) => row.dataset.envelopeGroup === session.group);
    if (!rows.length) return;
    const row =
      rows.find((item) => {
        const rect = item.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      }) || rows[rows.length - 1];
    const side =
      row === rows[rows.length - 1] &&
      y >=
        row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
        ? "after"
        : "before";
    const sourceIndex = rows.findIndex(
      (item) => item.dataset.envelopeId === session.id,
    );
    const targetIndex = rows.indexOf(row) + (side === "after" ? 1 : 0);
    setDrop(
      targetIndex === sourceIndex || targetIndex === sourceIndex + 1
        ? undefined
        : { id: row.dataset.envelopeId!, side },
    );
  }
  function scrollWhileDragging() {
    const session = dragSession.current;
    if (!session?.active) return;
    updateDragPreview();
    const dialog = listRef.current?.closest("dialog");
    if (dialog) {
      const bounds = dialog.getBoundingClientRect();
      const edge = 64;
      const amount =
        session.y < bounds.top + edge
          ? -Math.min(18, Math.ceil((bounds.top + edge - session.y) / 5))
          : session.y > bounds.bottom - edge
            ? Math.min(18, Math.ceil((session.y - (bounds.bottom - edge)) / 5))
            : 0;
      if (amount) {
        const before = dialog.scrollTop;
        dialog.scrollTop += amount;
        if (dialog.scrollTop !== before) updateDrop(session.x, session.y);
      }
    }
    autoScrollFrame.current = requestAnimationFrame(scrollWhileDragging);
  }
  function endDrag() {
    dragSession.current = undefined;
    if (autoScrollFrame.current !== undefined)
      cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = undefined;
    setDragPreview(undefined);
    setDrop();
  }
  function editedDraft(): Envelope {
    if (!draft) throw new Error("Choose an envelope.");
    const edited = {
      ...draft,
      name: draft.name.trim(),
      target: target.trim() === "" ? null : cents(target),
    };
    if (!edited.name) throw new Error("Enter an envelope name.");
    if (edited.target !== null && edited.target < 0)
      throw new Error("Full amounts cannot be negative.");
    return edited;
  }
  async function persist(
    next: Envelope[],
    nextTransfers: Transaction[],
    fallback: string,
  ) {
    const changed: BudgetRecord[] = next
      .map((e, i) => ({ ...e, order: i }))
      .filter((e) => JSON.stringify(e) !== JSON.stringify(state.records[e.id]));
    if (fallback !== settings(state).fallbackId)
      changed.push({ ...settings(state), fallbackId: fallback });
    changed.push(...nextTransfers);
    const guards = Object.fromEntries(
      next
        .filter(
          (e) => e.archived && !(state.records[e.id] as Envelope)?.archived,
        )
        .map((e) => [e.id, initialBalances[e.id] || 0]),
    );
    if (changed.length) await save(changed, "Update envelopes", guards);
  }
  async function doArchive() {
    const item = items.find((e) => e.id === archive);
    if (!item) return;
    const balance = bs[item.id] || 0;
    if (balance !== 0 && !destination) {
      setError("Choose an envelope to settle this balance.");
      return;
    }
    if (item.id === defaultId) {
      setError(
        "Choose a different default expense envelope before archiving this one.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const archivedItem = {
        ...(draft?.id === item.id ? editedDraft() : item),
        archived: true,
      };
      const nextTransfers: Transaction[] = [];
      if (balance !== 0)
        nextTransfers.push({
          id: crypto.randomUUID(),
          kind: "transaction",
          version: 0,
          type: "transfer",
          payee: `Archive ${item.name}`,
          amount: Math.abs(balance),
          date: today(settings(state).timezone),
          note: "Settled balance before archiving",
          tags: [],
          allocations: [
            { envelopeId: item.id, amount: -balance },
            { envelopeId: destination, amount: balance },
          ],
          pending: false,
          deleted: false,
          excluded: false,
          source: "manual",
          updatedAt: new Date().toISOString(),
        });
      const next = items.map((e) => (e.id === item.id ? archivedItem : e));
      await persist(next, nextTransfers, defaultId);
      onSaved("Envelope archived");
      onArchived?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      let next = items;
      let fallback = defaultId;
      if (draft) {
        const edited = editedDraft();
        next = items.some((e) => e.id === edited.id)
          ? items.map((e) => (e.id === edited.id ? edited : e))
          : [...items, edited];
        if (!fallback) fallback = edited.id;
        if (!initialId) {
          setItems(next);
          setDefault(fallback);
          setDraft(undefined);
          return;
        }
      }
      await persist(next, [], fallback);
      onSaved(draft ? "Envelope saved" : "Budget saved");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = items.filter((e) => !e.archived);
  const archived = items.filter((e) => e.archived);
  const pendingUnarchiveCount = items.filter(
    (item) =>
      !item.archived &&
      state.records[item.id]?.kind === "envelope" &&
      (state.records[item.id] as Envelope).archived,
  ).length;
  const grouped = new Map<string, Envelope[]>();
  for (const e of active) {
    const group = e.group?.trim() || "Envelopes";
    grouped.set(group, [...(grouped.get(group) || []), e]);
  }
  return (
    <Modal
      title={
        archive
          ? `Archive ${items.find((e) => e.id === archive)?.name || "envelope"}?`
          : showArchived
            ? "Archived envelopes"
            : draft
              ? "Edit envelope"
              : "Edit budget"
      }
      onClose={() => {
        if (busy) return;
        if (archive) {
          setArchive(undefined);
          setError("");
          return;
        }
        setArchive(undefined);
        setError("");
        if (showArchived) setShowArchived(false);
        else if (draft && !initialId) setDraft(undefined);
        else onClose();
      }}
      className="budget-editor"
      wide
      action={
        archive ? null : (
          <button
            className="header-save"
            type="submit"
            form={formId}
            disabled={busy || !!archive}
          >
            {busy ? "Saving…" : draft ? "Save" : "Done"}
          </button>
        )
      }
    >
      <form id={formId} ref={formRef} onSubmit={submit}>
        {archive ? (
          <div className="archive-prompt">
            <p>
              {bs[archive]
                ? "Move its balance to zero before archiving. "
                : "This envelope will be hidden from your list. "}
              Its transaction history will stay intact.
            </p>
            {!!bs[archive] && (
              <Field
                label={
                  bs[archive] > 0
                    ? `Move ${moneyText(bs[archive])} to`
                    : `Cover ${moneyText(-bs[archive])} from`
                }
              >
                <Select
                  label={
                    bs[archive] > 0 ? "Move balance to" : "Cover balance from"
                  }
                  searchable
                  value={destination}
                  onChange={setDestination}
                  options={[
                    { value: "", label: "Choose an envelope" },
                    ...active
                      .filter((e) => e.id !== archive)
                      .map((e) => ({
                        value: e.id,
                        label: e.name,
                        detail: moneyText(bs[e.id] || 0),
                      })),
                  ]}
                />
              </Field>
            )}
            <div className="button-row">
              <button
                type="button"
                className="button primary"
                onClick={doArchive}
                disabled={busy || (!!bs[archive] && !destination)}
              >
                {busy
                  ? "Archiving…"
                  : bs[archive]
                    ? "Settle & archive"
                    : "Archive envelope"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setArchive(undefined);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : showArchived ? (
          <div className="archived-envelope-list">
            <button
              type="button"
              className="archived-back"
              onClick={() => setShowArchived(false)}
            >
              <ArrowLeft size={17} /> Back to edit budget
            </button>
            <p className="archived-help">
              {pendingUnarchiveCount
                ? `${pendingUnarchiveCount} envelope${pendingUnarchiveCount === 1 ? " is" : "s are"} ready to unarchive. Tap Done to save.`
                : "Unarchive an envelope to return it to your budget. Tap Done to save."}
            </p>
            {archived.length ? (
              archived.map((env) => (
                <div className="archived-envelope-row" key={env.id}>
                  <span className="edit-envelope-name">
                    <EnvelopeIcon name={env.icon} size={17} />
                    {env.name}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Unarchive ${env.name}`}
                    disabled={busy}
                    onClick={() =>
                      setItems((current) =>
                        current.map((item) =>
                          item.id === env.id
                            ? { ...item, archived: false }
                            : item,
                        ),
                      )
                    }
                  >
                    <Undo2 size={15} /> Unarchive
                  </button>
                </div>
              ))
            ) : (
              <p className="archived-empty">No archived envelopes remain.</p>
            )}
          </div>
        ) : draft ? (
          <div className="structured-form envelope-editor">
            <section className="form-row-group">
              <Field label="Name">
                <input
                  autoFocus
                  value={draft.name}
                  placeholder="Envelope name"
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Full amount">
                <input
                  aria-label="Full amount"
                  inputMode="decimal"
                  placeholder="No target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </Field>
            </section>
            <IconPicker
              value={draft.icon}
              onChange={(icon) => setDraft({ ...draft, icon })}
            />
            <section className="form-row-group">
              <Field label="Group">
                <Combo
                  id="envelope-groups"
                  label="Group"
                  placeholder="Optional"
                  value={draft.group || ""}
                  onChange={(group) => setDraft({ ...draft, group })}
                  maxLength={80}
                  options={[
                    "Weekly",
                    "Annual",
                    ...items.map((e) => e.group || "").filter(Boolean),
                  ]}
                />
              </Field>
            </section>
            <label className="envelope-pace-setting">
              <input
                type="checkbox"
                checked={draft.weeklyPaceEnabled !== false}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    weeklyPaceEnabled: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Track weekly pace</strong>
                <small>
                  Show the weekly pace card and marker when this envelope has a
                  full amount.
                </small>
              </span>
            </label>
            <label className="envelope-pace-setting">
              <input
                type="checkbox"
                checked={draft.fiveWeekFundingEnabled === true}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    fiveWeekFundingEnabled: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Allow five-week funding</strong>
                <small>
                  Show Add 5 weeks when filling this envelope. Adds the full
                  amount ÷ 4 × 5.
                </small>
              </span>
            </label>
            {!draft.archived &&
              items.some((e) => e.id === draft.id) &&
              !archive && (
                <button
                  type="button"
                  className="archive-envelope-action"
                  onClick={() => {
                    setArchive(draft.id);
                    setDestination("");
                    setError("");
                  }}
                >
                  <Archive size={18} /> Archive envelope
                </button>
              )}
          </div>
        ) : (
          <div className="budget-edit-list" ref={restoreList}>
            {[...grouped].map(([name, group]) => (
              <section key={name}>
                <div className="list-section-heading">
                  <h3>{name}</h3>
                  <small>Full amount</small>
                </div>
                {group.map((env, index) => (
                  <div
                    className={
                      "budget-edit-row " +
                      (dragPreview?.id === env.id ? "dragging " : "") +
                      (dropTarget?.id === env.id
                        ? `drop-${dropTarget.side}`
                        : "")
                    }
                    data-envelope-id={env.id}
                    data-envelope-group={name}
                    key={env.id}
                  >
                    <button
                      type="button"
                      className="archive-control"
                      aria-label={`Archive ${env.name}`}
                      onClick={() => {
                        setArchive(env.id);
                        setDestination("");
                        setError("");
                      }}
                    >
                      <Minus size={15} />
                    </button>
                    <button
                      type="button"
                      className="edit-envelope-link"
                      onClick={() => open(env)}
                    >
                      <span className="edit-envelope-name">
                        <EnvelopeIcon name={env.icon} size={17} />
                        {env.name}
                      </span>
                      <span>
                        {env.target === null ? "—" : amountText(env.target)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`Reorder ${env.name}`}
                      title="Drag to reorder, or use the up and down arrow keys"
                      onKeyDown={(e) => {
                        if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
                          return;
                        e.preventDefault();
                        const other =
                          group[index + (e.key === "ArrowUp" ? -1 : 1)];
                        if (!other) return;
                        move(
                          env.id,
                          other.id,
                          e.key === "ArrowUp" ? "before" : "after",
                        );
                        setReorderMessage(
                          `${env.name} moved ${e.key === "ArrowUp" ? "up" : "down"}.`,
                        );
                      }}
                      onPointerDown={(e) => {
                        if (e.pointerType === "mouse" && e.button !== 0) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        dragSession.current = {
                          id: env.id,
                          group: name,
                          pointerId: e.pointerId,
                          startX: e.clientX,
                          startY: e.clientY,
                          x: e.clientX,
                          y: e.clientY,
                          grabY: 0,
                          active: false,
                        };
                      }}
                      onPointerMove={(e) => {
                        const session = dragSession.current;
                        if (!session || session.pointerId !== e.pointerId)
                          return;
                        session.x = e.clientX;
                        session.y = e.clientY;
                        if (!session.active) {
                          if (
                            Math.hypot(
                              session.x - session.startX,
                              session.y - session.startY,
                            ) < 5
                          )
                            return;
                          session.active = true;
                          const row =
                            e.currentTarget.closest<HTMLElement>(
                              ".budget-edit-row",
                            );
                          const list = listRef.current;
                          if (!row || !list) {
                            endDrag();
                            return;
                          }
                          const rect = row.getBoundingClientRect();
                          const listRect = list.getBoundingClientRect();
                          session.grabY = session.startY - rect.top;
                          setDragPreview({
                            id: env.id,
                            left: rect.left - listRect.left,
                            width: rect.width,
                            height: rect.height,
                          });
                          autoScrollFrame.current =
                            requestAnimationFrame(scrollWhileDragging);
                        }
                        updateDragPreview();
                        updateDrop(session.x, session.y);
                      }}
                      onPointerUp={(e) => {
                        const session = dragSession.current;
                        if (
                          session?.pointerId === e.pointerId &&
                          session.active
                        ) {
                          updateDrop(e.clientX, e.clientY);
                          const target = dropTargetRef.current;
                          if (target) {
                            move(env.id, target.id, target.side);
                            setReorderMessage(`${env.name} moved.`);
                          }
                        }
                        if (e.currentTarget.hasPointerCapture(e.pointerId))
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        endDrag();
                      }}
                      onPointerCancel={endDrag}
                      onLostPointerCapture={endDrag}
                    >
                      <GripVertical size={18} strokeWidth={1.8} />
                    </button>
                  </div>
                ))}
              </section>
            ))}
            {dragPreview &&
              (() => {
                const env = items.find((item) => item.id === dragPreview.id);
                if (!env) return null;
                return (
                  <div
                    ref={dragPreviewRef}
                    className="budget-drag-preview"
                    style={{
                      left: dragPreview.left,
                      width: dragPreview.width,
                      height: dragPreview.height,
                    }}
                    aria-hidden="true"
                  >
                    <span className="archive-control">
                      <Minus size={15} />
                    </span>
                    <span className="edit-envelope-link">
                      <span className="edit-envelope-name">
                        <EnvelopeIcon name={env.icon} size={17} />
                        {env.name}
                      </span>
                      <span>
                        {env.target === null ? "—" : amountText(env.target)}
                      </span>
                    </span>
                    <span className="drag-handle">
                      <GripVertical size={18} strokeWidth={1.8} />
                    </span>
                  </div>
                );
              })()}
            <span className="reorder-announcement" role="status">
              {reorderMessage}
            </span>
            <button className="new-envelope-row" type="button" onClick={add}>
              <Plus size={19} /> New envelope
            </button>
            <div className="structured-form budget-options">
              <section className="form-row-group">
                <Field label="Default envelope">
                  <Select
                    label="Default envelope"
                    searchable
                    value={defaultId}
                    onChange={setDefault}
                    options={active.map((e) => ({
                      value: e.id,
                      label: e.name,
                    }))}
                  />
                </Field>
              </section>
            </div>
            {archived.length > 0 && (
              <button
                type="button"
                className="archived-toggle"
                onClick={openArchived}
              >
                Archived envelopes <ChevronRight size={16} />
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error editor-error" role="alert">
            {error}
          </p>
        )}
        {!archive && !draft && !showArchived && (
          <div className="budget-edit-total">
            <span>Total budgeted</span>
            <strong>
              {moneyText(active.reduce((sum, e) => sum + (e.target || 0), 0))}
            </strong>
          </div>
        )}
      </form>
    </Modal>
  );
}
