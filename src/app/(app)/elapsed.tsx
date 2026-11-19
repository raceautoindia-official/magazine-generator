"use client";

import { useEffect, useState } from "react";

/**
 * A running clock shown while something is being worked on, so the wait is
 * never a blank. Mount it only while the work runs: it counts from the moment
 * it appears.
 */
export function Elapsed({ className }: { className?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);
  return (
    <span className={`tabular-nums ${className ?? ""}`} aria-hidden>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}
