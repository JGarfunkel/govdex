"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const REVEAL_DELAY_MS = 10 * 60 * 1000;

export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  async function handleClick() {
    setState("loading");
    try {
      const res = await fetch("/transparency/api/refresh", { method: "POST" });
      if (!res.ok) throw new Error("refresh failed");
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      className={revealed ? "refresh-btn" : "refresh-btn refresh-btn-hidden"}
      onClick={handleClick}
      disabled={state === "loading"}
    >
      <i className={`ti ti-refresh${state === "loading" ? " spin" : ""}`} aria-hidden="true" />
      {state === "loading" ? "Refreshing…" : state === "error" ? "Refresh failed — retry" : "Refresh"}
    </button>
  );
}
