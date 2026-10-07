import { useId, useLayoutEffect, useRef, useState } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import EnvelopeIcon from "./EnvelopeIcon";
import {
  envelopeIcons,
  iconLabel,
  resolveEnvelopeIcon,
  searchEnvelopeIcons,
} from "../lib/envelope-icons";
const pageSize = 72;
export default function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const iconGrid = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = resolveEnvelopeIcon(value);
  const matches = searchEnvelopeIcons(query);
  const pages = Math.ceil(matches.length / pageSize);
  useLayoutEffect(() => {
    if (iconGrid.current) iconGrid.current.scrollTop = 0;
  }, [query]);
  return (
    <div className="icon-picker">
      <button
        type="button"
        className="icon-picker-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>Icon</span>
        <span>
          <EnvelopeIcon name={selected.name} />
          {iconLabel(selected.name)}
          <ChevronRight size={15} />
        </span>
      </button>
      {open && (
        <section
          id={id}
          className="icon-picker-panel"
          aria-label="Choose envelope icon"
        >
          <label className="icon-picker-search">
            <Search size={16} />
            <input
              autoFocus
              aria-label="Search Phosphor icons"
              placeholder="Search icons…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <div className="icon-picker-count" role="status">
            {query
              ? `${matches.length.toLocaleString()} matches`
              : `All ${envelopeIcons.length.toLocaleString()} Phosphor icons`}
          </div>
          <div ref={iconGrid} className="icon-picker-grid">
            {matches
              .slice(page * pageSize, (page + 1) * pageSize)
              .map((icon) => (
                <button
                  key={icon.name}
                  type="button"
                  className={icon.name === selected.name ? "selected" : ""}
                  aria-label={`Use ${iconLabel(icon.name)} icon`}
                  aria-pressed={icon.name === selected.name}
                  title={iconLabel(icon.name)}
                  onClick={() => onChange(icon.name)}
                >
                  <EnvelopeIcon name={icon.name} size={24} />
                </button>
              ))}
          </div>
          {!matches.length && (
            <p className="icon-picker-empty">
              No icons found. Try a different name or keyword.
            </p>
          )}
          <div className="icon-picker-footer">
            <button
              type="button"
              className="icon-picker-page"
              aria-label="Previous icon page"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {matches.length ? `${page + 1} / ${pages}` : "0 results"}
            </span>
            <button
              type="button"
              className="icon-picker-page"
              aria-label="Next icon page"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={17} />
            </button>
            <button
              type="button"
              className="icon-picker-done"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
