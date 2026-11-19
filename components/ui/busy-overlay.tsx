"use client";

import { useEffect, useState } from "react";
import { useEditor, type Locale } from "@/lib/store";

function tr(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

/** Full-panel progress cover. Shared by the home screen and the editor. */
export function BusyOverlay({ className = "" }: { className?: string }) {
  const busy = useEditor((s) => s.busy);
  const label = useEditor((s) => s.busyLabel);
  const since = useEditor((s) => s.busySince);
  const locale = useEditor((s) => s.locale);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const read = () => setSeconds(Math.max(0, Math.round((Date.now() - since) / 1000)));
    // Both go through timer callbacks, so nothing is written during the effect body.
    const first = window.setTimeout(read, 0);
    const timer = window.setInterval(read, 500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [busy, since]);

  if (!busy) return null;
  return (
    <div
      className={`absolute inset-0 z-30 grid place-items-center bg-[#10131a]/85 px-6 text-center ${className}`}
      role="status"
      aria-live="polite"
    >
      <div>
        <p className="text-lg text-[#f3efe6]">{label || tr(locale, "请稍等", "Working")}</p>
        {seconds > 0 ? <p className="mt-2 text-sm tabular-nums text-[#d7a15e]">{seconds}s</p> : null}
      </div>
    </div>
  );
}
