import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

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
  const optionList = useRef<HTMLDivElement>(null);
  const id = useId();
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

  function toggle(key: string) {
    onChange(
      selected.includes(key)
        ? selected.filter((tag) => tag !== key)
        : [...selected, key],
    );
  }

  return (
    <div
      className="tag-filter"
      ref={root}
      onBlur={(event) => {
        // Clicking a label's text can briefly move focus to the document body.
        // Let the outside pointer handler close the menu instead of doing it
        // before the label has a chance to toggle its checkbox.
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
          root.current
            ?.querySelector<HTMLButtonElement>(".tag-filter-trigger")
            ?.focus();
        }
      }}
    >
      <button
        type="button"
        className="tag-filter-trigger"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected.length ? `Tags (${selected.length})` : "Tags"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
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
            role="group"
            aria-label="Tags"
          >
            {matches.map((option) => (
              <label className="tag-filter-option" key={option.key}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.key)}
                  onChange={() => toggle(option.key)}
                />
                <span>{option.label}</span>
              </label>
            ))}
            {!matches.length && (
              <p className="tag-filter-empty">
                {options.length ? "No matching tags" : "No tags yet"}
              </p>
            )}
          </div>
          <div className="tag-filter-actions">
            {selected.length > 0 && (
              <button type="button" onClick={() => onChange([])}>
                Clear tags
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
