import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type TagOption = { key: string; label: string };

export default function TagFilter({
  options,
  selected,
  onChange,
}: {
  options: TagOption[];
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionList = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ key: string; x: number; y: number } | null>(null);
  const id = useId();
  const selectedOption = options.find((option) => option.key === selected[0]);
  const matches = options.filter((option) =>
    option.label
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  useLayoutEffect(() => {
    if (optionList.current) optionList.current.scrollTop = 0;
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function choose(key: string) {
    onChange([key]);
    setSearch("");
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return (
    <div
      className="tag-filter"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }
      }}
    >
      <div
        className={`tag-filter-control${selected.length ? " has-selection" : ""}`}
      >
        <button
          ref={trigger}
          type="button"
          className="tag-filter-trigger"
          aria-label={selectedOption ? `Tags, ${selectedOption.label}` : "Tags"}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => {
            setSearch("");
            setOpen((value) => !value);
          }}
        >
          <span className="tag-filter-label">Tags</span>
          {selectedOption && (
            <span className="tag-filter-value">{selectedOption.label}</span>
          )}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            className="tag-filter-clear"
            aria-label="Clear tag filter"
            title="Clear tag filter"
            onClick={() => {
              onChange([]);
              setSearch("");
              setOpen(false);
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="tag-filter-popover" id={id}>
          <label className="tag-filter-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search tags"
              placeholder="Find a tag…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div
            ref={optionList}
            className="tag-filter-options"
            role="listbox"
            aria-label="Tags"
          >
            {matches.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={selected.includes(option.key)}
                className="tag-filter-option"
                key={option.key}
                onPointerDown={(event) => {
                  if (event.pointerType !== "touch") return;
                  event.preventDefault();
                  touchStart.current = {
                    key: option.key,
                    x: event.clientX,
                    y: event.clientY,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerUp={(event) => {
                  const start = touchStart.current;
                  touchStart.current = null;
                  if (
                    start?.key === option.key &&
                    Math.hypot(
                      event.clientX - start.x,
                      event.clientY - start.y,
                    ) < 12
                  )
                    choose(option.key);
                }}
                onPointerCancel={() => {
                  touchStart.current = null;
                }}
                onClick={(event) => {
                  if (
                    (event.nativeEvent as PointerEvent).pointerType !== "touch"
                  )
                    choose(option.key);
                }}
              >
                <span className="tag-filter-check" aria-hidden="true">
                  {selected.includes(option.key) && <Check size={15} />}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
            {!matches.length && (
              <p className="tag-filter-empty">
                {options.length ? "No matching tags" : "No tags yet"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
