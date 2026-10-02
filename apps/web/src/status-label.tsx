"use client";

import { useEffect, useState } from "react";
import { Mark } from "./mark.js";
export type Status =
  | "ready"
  | "loading"
  | "confirmed"
  | "broadcast"
  | "broadcast_unknown"
  | "failed";

export function StateLabel({ state, text }: { state: Status; text: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (state !== "loading" && state !== "broadcast") return;
    const timer = setTimeout(() => setVisible(true), 250);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <div role="status" aria-live="polite" className={`state ${state}`}>
      {visible ? <Mark loading /> : <span className="status-dot" />}
      <span>{text}</span>
    </div>
  );
}
