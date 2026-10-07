import type { ReactNode } from "react";
import {
  motion,
  useIsPresent,
  usePresenceData,
  useReducedMotion,
} from "motion/react";
export type NavigationMotion = { direction: number; distance: number };
export default function ScreenTransition({
  children,
}: {
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const navigation = usePresenceData() as NavigationMotion | undefined;
  const offset = reduced
    ? 0
    : (navigation?.direction || 1) * (navigation?.distance || 20);
  return (
    <motion.div
      className="budget-screen"
      inert={!present}
      aria-hidden={!present ? true : undefined}
      style={{ position: present ? "relative" : "absolute" }}
      initial={{ opacity: reduced ? 1 : 0, x: offset }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: reduced ? 1 : 0, x: -offset * 0.5 }}
      transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
