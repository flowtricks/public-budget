import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/** Keep menus in the top layer so scrolling forms cannot clip their options. */
export default function DropdownPopover({
  anchor,
  className = "",
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const popup = ref.current;
    const target = anchor.current;
    if (!popup || !target) return;
    popup.showPopover();
    const position = () => {
      const rect = target.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const gap = 4;
      const margin = 12;
      const below = Math.max(0, top + height - rect.bottom - margin - gap);
      const above = Math.max(0, rect.top - top - margin - gap);
      const preferredHeight = 300;
      const upwards = below < preferredHeight && above > below;
      const available = upwards ? above : below;
      popup.style.width = `${Math.min(Math.max(rect.width, 260), width - margin * 2)}px`;
      popup.style.setProperty("--menu-height", `${available}px`);
      popup.style.left = `${Math.max(left + margin, Math.min(rect.right - popup.offsetWidth, left + width - popup.offsetWidth - margin))}px`;
      popup.style.top = `${upwards ? rect.top - gap - popup.offsetHeight : rect.bottom + gap}px`;
    };
    position();
    // The dialog can still be moving when auto-focus opens this menu. Its
    // transform changes the anchor's position without triggering scroll or
    // ResizeObserver, so follow it through the entrance animation.
    let frame = 0;
    const followUntil = performance.now() + 600;
    const followAnchor = () => {
      position();
      if (performance.now() < followUntil)
        frame = window.requestAnimationFrame(followAnchor);
    };
    frame = window.requestAnimationFrame(followAnchor);
    const onScroll = (event: Event) => {
      if (!popup.contains(event.target as Node)) position();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const observer = new ResizeObserver(position);
    observer.observe(target);
    observer.observe(popup);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [anchor]);
  return (
    <div
      ref={ref}
      popover="manual"
      className={`combo-popover anchored-popover ${className}`}
    >
      {children}
    </div>
  );
}
