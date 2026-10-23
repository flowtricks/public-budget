import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from "react";
import {
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Check,
} from "lucide-react";
import DropdownPopover from "./DropdownPopover";
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  action,
  className = "",
  initialFocus,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  action?: ReactNode;
  className?: string;
  initialFocus?: string;
}) {
  const titleId = useId();
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    if (initialFocus)
      el?.querySelector<HTMLElement>(initialFocus)?.focus({ preventScroll: true });
    return () => el?.close();
  }, []);
  return (
    <motion.dialog
      inert={!present}
      data-exiting={!present || undefined}
      initial={{
        opacity: reduced ? 1 : 0,
        y: reduced ? 0 : 36,
        scale: reduced ? 1 : 0.99,
      }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{
        opacity: reduced ? 1 : 0,
        y: reduced ? 0 : 28,
        scale: reduced ? 1 : 0.99,
      }}
      transition={{
        duration: reduced ? 0 : present ? 0.25 : 0.16,
        ease: [0.22, 1, 0.36, 1],
      }}
      aria-labelledby={titleId}
      ref={ref}
      className={"modal " + (wide ? "wide " : "") + className}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <div className="modal-title">
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <div className="modal-action">{action}</div>
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={title}
          className="modal-screen"
          initial={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(new Date(value + "T12:00:00"));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const year = cursor.getFullYear(),
    month = cursor.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return (
    <div className="date-control" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="date-trigger"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <CalendarDays size={16} />
        {new Date(value + "T12:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </button>
      {open && (
        <DropdownPopover anchor={trigger} className="calendar calendar-popover">
          <div className="calendar-head">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setCursor(new Date(year, month - 1, 1))}
            >
              <ChevronLeft size={16} />
            </button>
            <strong>
              {cursor.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setCursor(new Date(year, month + 1, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="calendar-grid">
            {"SMTWTFS".split("").map((d, i) => (
              <span key={i}>{d}</span>
            ))}
            {Array.from({ length: first }, (_, i) => (
              <i key={"blank" + i} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
              return (
                <button
                  type="button"
                  key={d}
                  className={d === value ? "selected" : ""}
                  onClick={() => {
                    onChange(d);
                    setOpen(false);
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <input
            aria-label="Enter date"
            type="date"
            value={value}
            onChange={(e) => {
              if (e.target.value) {
                onChange(e.target.value);
                setOpen(false);
              }
            }}
          />
        </DropdownPopover>
      )}
    </div>
  );
}
export function Combo({
  label,
  value,
  onChange,
  onSelect,
  options,
  renderOption,
  placeholder,
  id,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSelect?: (option: string) => void;
  options: string[];
  renderOption?: (option: string) => ReactNode;
  placeholder?: string;
  id: string;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const optionList = useRef<HTMLDivElement>(null);
  const optionPointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const uid = useId();
  const listId = `${id}-${uid}`;
  const matches = [...new Set(options)]
    .filter((option) =>
      option.toLowerCase().includes(value.trim().toLowerCase()),
    )
    .slice(0, 50);
  useLayoutEffect(() => {
    if (optionList.current) optionList.current.scrollTop = 0;
  }, [value]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (open && active >= 0)
      root.current
        ?.querySelector(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  function choose(option: string) {
    onChange(option);
    setOpen(false);
    setActive(-1);
    if (onSelect) onSelect(option);
    else input.current?.focus();
  }
  return (
    <div
      className="combo-control"
      ref={root}
      onBlur={(event) => {
        if (
          !optionPointer.current &&
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && active >= 0 && matches[active]
            ? `${listId}-${active}`
            : undefined
        }
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              !matches.length
                ? -1
                : event.key === "ArrowDown"
                  ? (current + 1) % matches.length
                  : current <= 0
                    ? matches.length - 1
                    : current - 1,
            );
          } else if (
            event.key === "Enter" &&
            open &&
            active >= 0 &&
            matches[active]
          ) {
            event.preventDefault();
            choose(matches[active]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
        }}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="combo-chevron"
        aria-label={`Toggle ${label.toLowerCase()} suggestions`}
        tabIndex={-1}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") event.preventDefault();
        }}
        onClick={(event) => {
          event.preventDefault();
          const next = !open;
          input.current?.focus();
          setOpen(next);
          setActive(-1);
        }}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <DropdownPopover anchor={input}>
          <div
            ref={optionList}
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="combo-options"
          >
            {matches.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                data-option-index={index}
                key={option}
                aria-selected={active === index}
                className={active === index ? "active" : ""}
                onPointerDown={(event) => {
                  optionPointer.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                  };
                  if (event.pointerType === "mouse") event.preventDefault();
                }}
                onPointerUp={(event) => {
                  const start = optionPointer.current;
                  if (!start || start.id !== event.pointerId) return;
                  if (
                    Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 10
                  ) {
                    optionPointer.current = null;
                    return;
                  }
                  window.setTimeout(() => {
                    if (optionPointer.current === start)
                      optionPointer.current = null;
                  }, 500);
                }}
                onPointerCancel={() => {
                  optionPointer.current = null;
                }}
                onClick={(event) => {
                  event.preventDefault();
                  optionPointer.current = null;
                  choose(option);
                }}
              >
                <span className="combo-option-label">
                  {renderOption?.(option)}
                  <span>{option}</span>
                </span>
                {option === value && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
          {!matches.length && (
            <p className="combo-empty">
              {value
                ? "No matches. You can use what you typed."
                : "Type to add your first entry."}
            </p>
          )}
        </DropdownPopover>
      )}
    </div>
  );
}
