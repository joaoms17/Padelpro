"use client";

import { useEffect, useState } from "react";
import { getApiHealth, EXPECTED_API_BUILD } from "@/lib/api";

type ApiState = "ok" | "outdated" | "offline" | "checking";

export function ApiBanner() {
  const [state, setState] = useState<ApiState>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const h = await getApiHealth();
        if (cancelled) return;
        setState((h.api_build ?? 0) >= EXPECTED_API_BUILD ? "ok" : "outdated");
      } catch {
        if (!cancelled) setState("offline");
      }
    };
    check();
    const iv = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  if (state === "ok" || state === "checking") return null;

  return (
    <div className="bg-yellow-950/80 border-b border-yellow-700 px-6 py-2 text-center text-sm text-yellow-200">
      {state === "outdated"
        ? "⚠️ A API está a atualizar — recarrega daqui a pouco."
        : "⚠️ O servidor está temporariamente indisponível — tenta novamente daqui a pouco."}
    </div>
  );
}
