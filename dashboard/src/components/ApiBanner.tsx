"use client";

import { useEffect, useState } from "react";
import { getApiHealth, EXPECTED_API_BUILD } from "@/lib/api";

type ApiState = "ok" | "outdated" | "offline" | "checking";

function hardRefresh() {
  // Add a cache-busting param so the browser fetches everything fresh
  const url = new URL(window.location.href);
  url.searchParams.set("_r", Date.now().toString());
  window.location.replace(url.toString());
}

export function ApiBanner() {
  const [state, setState] = useState<ApiState>("checking");
  const [apiBuild, setApiBuild] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const h = await getApiHealth();
        if (cancelled) return;
        setApiBuild(h.api_build ?? null);
        setState((h.api_build ?? 0) >= EXPECTED_API_BUILD ? "ok" : "outdated");
      } catch {
        if (!cancelled) setState("offline");
      }
    };
    check();
    const iv = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const versionLabel = apiBuild != null ? `API v${apiBuild}` : "API …";

  // Always-visible small bar at the bottom of the top-bar
  const isWarning = state === "outdated" || state === "offline";

  return (
    <div
      className={`border-b px-4 py-1.5 flex items-center justify-between gap-3 text-xs ${
        isWarning
          ? "bg-yellow-950/80 border-yellow-700 text-yellow-200"
          : "bg-[#060F1A] border-gray-800/60 text-gray-500"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            state === "ok" ? "bg-green-500" :
            state === "outdated" ? "bg-yellow-400" :
            state === "offline" ? "bg-red-500" :
            "bg-gray-600 animate-pulse"
          }`}
        />
        {versionLabel}
        {state === "outdated" && <span className="ml-1">— ⚠️ versão antiga, recarrega</span>}
        {state === "offline" && <span className="ml-1">— ⚠️ servidor indisponível</span>}
      </span>

      <button
        onClick={hardRefresh}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500 hover:text-gray-300 transition-colors"
        title="Forçar reload completo (bypassa cache)"
      >
        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.65 2.35A8 8 0 1 0 15 8h-1.5a6.5 6.5 0 1 1-1.28-3.9L10 6h5V1l-1.35 1.35z"/>
        </svg>
        Atualizar
      </button>
    </div>
  );
}
