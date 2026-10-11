import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import DropdownPopover from "./DropdownPopover";

export default function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  searchable = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; detail?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const optionList = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const touchSelected = useRef(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const selected = options.findIndex((option) => option.value === value);
  const menuOptions = searchable
    ? options.filter((option) => option.value !== "")
    : options;
  const selectedMenu = menuOptions.findIndex((option) => option.value === value);
  const visibleOptions = searchable && query.trim()
    ? menuOptions.filter((option) =>
        option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      )
    : menuOptions;

  useLayoutEffect(() => {
    if (optionList.current) optionList.current.scrollTop = 0;
  }, [query]);

  useLayoutEffect(() => {
    if (open && searchable) searchInput.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open)
      root.current
        ?.querySelector(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, query]);

  function choose(index: number) {
    if (!visibleOptions[index]) return;
    onChange(visibleOptions[index].value);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return (
    <div className={`combo-control select-control ${className}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && visibleOptions[active] ? `${id}-${active}` : undefined
        }
        disabled={disabled || !menuOptions.length}
        onClick={() => {
          if (!open) setQuery("");
          setActive(Math.max(0, selectedMenu));
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Tab") {
            setOpen(false);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active);
            else {
              setQuery("");
              setActive(Math.max(0, selectedMenu));
              setOpen(true);
            }
          } else if (
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            if (!open) setQuery("");
            setOpen(true);
            setActive((current) => {
              const navigationOptions = open ? visibleOptions : menuOptions;
              if (!navigationOptions.length) return 0;
              if (event.key === "Home") return 0;
              if (event.key === "End") return navigationOptions.length - 1;
              if (!open) return Math.max(0, selectedMenu);
              return (
                (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  navigationOptions.length) %
                navigationOptions.length
              );
            });
          } else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const match = menuOptions.findIndex((option) =>
              option.label.toLowerCase().startsWith(event.key.toLowerCase()),
            );
            if (match >= 0) {
              event.preventDefault();
              setQuery("");
              setActive(match);
              setOpen(true);
            }
          }
        }}
      >
        <span className="select-choice">
          <span>{options[selected]?.label || "Choose an option"}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <DropdownPopover anchor={trigger} className="select-popover">
          {searchable && (
            <div className="select-search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchInput}
                type="search"
                aria-label={`Search ${label.toLowerCase()}`}
                aria-controls={id}
                placeholder="Search envelopes"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    trigger.current?.focus({ preventScroll: true });
                  } else if (event.key === "Enter" && visibleOptions.length) {
                    event.preventDefault();
                    choose(active);
                  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    if (visibleOptions.length) {
                      setActive((current) =>
                        (current + (event.key === "ArrowDown" ? 1 : -1) + visibleOptions.length) % visibleOptions.length,
                      );
                    }
                  } else if (event.key === "Tab") {
                    setOpen(false);
                  }
                }}
              />
            </div>
          )}
          <div
            ref={optionList}
            id={id}
            role="listbox"
            aria-label={label}
            className="combo-options"
          >
            {visibleOptions.map((option, index) => (
              <button
                key={option.value}
                type="button"
                id={`${id}-${index}`}
                data-option-index={index}
                role="option"
                aria-selected={option.value === value}
                className={active === index ? "active" : undefined}
                onPointerDown={(event) => {
                  // Keep keyboard focus in the search field for mouse clicks.
                  if (event.pointerType === "mouse") event.preventDefault();
                  else
                    touchStart.current = {
                      id: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                    };
                }}
                onPointerMove={(event) => {
                  const start = touchStart.current;
                  if (
                    start?.id === event.pointerId &&
                    Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
                  )
                    touchStart.current = null;
                }}
                onPointerUp={(event) => {
                  const start = touchStart.current;
                  touchStart.current = null;
                  if (start?.id !== event.pointerId) return;
                  touchSelected.current = true;
                  choose(index);
                  window.setTimeout(() => {
                    touchSelected.current = false;
                  }, 350);
                }}
                onPointerCancel={() => {
                  touchStart.current = null;
                }}
                onClick={(event) => {
                  event.preventDefault();
                  if (touchSelected.current) {
                    touchSelected.current = false;
                    return;
                  }
                  choose(index);
                }}
              >
                <span className="select-option-content">
                  <span>{option.label}</span>
                  {option.detail && <small>{option.detail}</small>}
                </span>
                {option.value === value && (
                  <Check size={16} aria-hidden="true" />
                )}
              </button>
            ))}
            {visibleOptions.length === 0 && (
              <div className="combo-empty">No matching envelopes</div>
            )}
          </div>
        </DropdownPopover>
      )}
    </div>
  );
}
