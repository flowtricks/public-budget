import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export default function ModalPopup({
  anchor,
  open,
  onClose,
  title,
  role = "dialog",
  className = "",
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  title: string;
  role?: "dialog" | "alertdialog";
  className?: string;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    setHost(anchor.current?.closest("dialog") ?? document.body);
  }, [anchor, open]);

  useEffect(() => {
    if (!open || !host) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      panel.current
        ?.querySelector<HTMLElement>("[data-popup-autofocus]")
        ?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(frame);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open, host]);

  if (!host) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-popup-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        >
          <motion.div
            ref={panel}
            className={`modal-popup-card ${className}`}
            role={role}
            aria-modal="true"
            aria-label={title}
            initial={reduced ? false : { opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{
              duration: reduced ? 0 : 0.22,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    host,
  );
}
