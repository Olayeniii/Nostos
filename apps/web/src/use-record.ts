"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson, RequestError } from "./requests.js";
export function useRecord<T>(url: string, token?: string, enabled = true) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refresh = async () => {
    if (!enabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const version = generation.current;
    setLoading(true);
    try {
      const next = await requestJson<T>(
        url,
        {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        12000,
        controller.signal,
      );
      if (version !== generation.current) return;
      setData(next);
      setWarning("");
    } catch (e) {
      if (version !== generation.current) return;
      // Switching to a wallet can suspend mobile requests. Recheck on return.
      if (document.visibilityState === "hidden") return;
      if (!token && e instanceof RequestError && e.status === 401)
        window.location.assign("/sign-in");
      else
        setWarning(
          "Connection interrupted. Saved records remain visible. Refresh before taking action.",
        );
    } finally {
      if (version === generation.current) {
        active.current = null;
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    generation.current++;
    setData(undefined);
    setWarning("");
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 8000);
    return () => {
      generation.current++;
      active.current?.abort();
      active.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [url, token, enabled]);
  return { data, loading, warning, refresh };
}
