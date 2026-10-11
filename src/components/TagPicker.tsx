import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { normalizeTag } from "../lib/budget-index";
import { isAutomaticTag } from "../../shared/automatic-import";
import DropdownPopover from "./DropdownPopover";

export default function TagPicker({
  selected,
  draft,
  options,
  onChange,
  onDraftChange,
}: {
  selected: string[];
  draft: string;
  options: string[];
  onChange: (tags: string[]) => void;
  onDraftChange: (draft: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selectedKeys = new Set(selected.map(normalizeTag));
  const known = new Map<string, string>();
  for (const option of options) {
    const label = option.trim();
    const key = normalizeTag(label);
    if (key && !isAutomaticTag(label) && !known.has(key)) known.set(key, label);
  }
  const typed = draft.trim();
  const matches = [...known]
    .filter(
      ([key, label]) =>
        !selectedKeys.has(key) &&
        label.toLocaleLowerCase().includes(typed.toLocaleLowerCase()),
    )
    .map(([, label]) => label)
    .sort((a, b) => a.localeCompare(b));
  const canCreate =
    !!typed &&
    selected.length < 30 &&
    !known.has(normalizeTag(typed)) &&
    !selectedKeys.has(normalizeTag(typed)) &&
    !isAutomaticTag(typed);
  const choices =
    selected.length >= 30
      ? []
      : [
          ...(canCreate ? [{ label: typed, create: true }] : []),
          ...matches.map((label) => ({ label, create: false })),
        ];
  const showOptions = open && (choices.length > 0 || !!typed);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function add(label: string) {
    const key = normalizeTag(label);
    if (!key || selectedKeys.has(key) || selected.length >= 30) return;
    onChange([...selected, known.get(key) || label.trim()]);
    onDraftChange("");
    setActive(-1);
    setOpen(true);
    input.current?.focus();
  }

  return (
    <div
      className="tag-picker"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <div
        className="tag-picker-control"
        ref={control}
        onClick={() => input.current?.focus()}
      >
        {selected.map((tag) => (
          <span className="tag-picker-chip" key={normalizeTag(tag)}>
            <span>{tag}</span>
            <button
              type="button"
              aria-label={`Remove ${tag} tag`}
              onPointerDown={(event) => {
                if (event.pointerType === "mouse") event.preventDefault();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onChange(
                  selected.filter(
                    (item) => normalizeTag(item) !== normalizeTag(tag),
                  ),
                );
                input.current?.focus();
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id="transaction-tags"
          role="combobox"
          aria-label="Tags"
          aria-autocomplete="list"
          aria-expanded={showOptions}
          aria-controls={showOptions ? listId : undefined}
          aria-activedescendant={
            showOptions && active >= 0 ? `${listId}-${active}` : undefined
          }
          placeholder={selected.length ? "Add tag…" : "Optional"}
          value={draft}
          maxLength={60}
          autoComplete="off"
          disabled={selected.length >= 30}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onDraftChange(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((current) =>
                !choices.length
                  ? -1
                  : event.key === "ArrowDown"
                    ? (current + 1) % choices.length
                    : current <= 0
                      ? choices.length - 1
                      : current - 1,
              );
            } else if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              const choice =
                open && active >= 0 ? choices[active]?.label : typed;
              if (choice) add(choice);
            } else if (event.key === "Backspace" && !draft && selected.length) {
              onChange(selected.slice(0, -1));
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="tag-picker-chevron"
          aria-label="Toggle tag suggestions"
          aria-expanded={showOptions}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") event.preventDefault();
          }}
          onClick={(event) => {
            event.stopPropagation();
            const next = !open;
            input.current?.focus();
            setOpen(next);
            setActive(-1);
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      {showOptions && (
        <DropdownPopover anchor={control} className="tag-picker-popover">
          <div
            className="tag-picker-options"
            role="listbox"
            aria-label="Existing tags"
            id={listId}
          >
            {choices.map((choice, index) => (
              <button
                type="button"
                role="option"
                aria-selected={active === index}
                id={`${listId}-${index}`}
                className="tag-picker-option"
                key={`${choice.create ? "new" : "existing"}-${choice.label}`}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse") event.preventDefault();
                }}
                onClick={() => add(choice.label)}
              >
                {choice.create && <Plus size={15} aria-hidden="true" />}
                <span className="tag-picker-chip tag-picker-suggestion">
                  {choice.label}
                </span>
                {choice.create && (
                  <span className="tag-picker-add-label">Add new tag</span>
                )}
              </button>
            ))}
            {!choices.length && (
              <p className="combo-empty">
                {typed ? "No matching tags" : "No more tags to add"}
              </p>
            )}
          </div>
        </DropdownPopover>
      )}
    </div>
  );
}
