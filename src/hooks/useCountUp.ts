/**
 * useCountUp: animate a number from a previous value up to a target over a short
 * window, easing out. Reduced-motion aware (snaps straight to the target). Shared by
 * the round break and match results ceremonies so count-ups read identically.
 */

import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * @param countFromZero when true the value animates up from 0 on first mount (used by the
 *   results ceremony, where the panel mounts fresh and the numbers should tally in).
 */
export function useCountUp(
  target: number,
  durationMs = 900,
  delayMs = 0,
  countFromZero = false,
): number {
  const [value, setValue] = useState(countFromZero ? 0 : target);
  const fromRef = useRef(countFromZero ? 0 : target);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;

    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start - delayMs;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, delayMs]);

  return value;
}
