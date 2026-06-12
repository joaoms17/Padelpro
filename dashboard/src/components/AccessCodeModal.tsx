"use client";

import { useEffect, useState } from "react";
import { setAccessCode, consumeNeedsCode } from "@/lib/api";

/**
 * Shown when the API answers 401 (a shared access code is required).
 * Replaces the flaky window.prompt with a real form; saving reloads so the
 * stored code is sent on every subsequent request.
 */
export function AccessCodeModal() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    // Foolproof path: code can travel in the URL (?code=...). Store it and
    // strip it from the address bar so a shared "link + code" just works.
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("code");
    if (fromUrl) {
      setAccessCode(fromUrl.trim());
      params.delete("code");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      return;   // already authenticated — no need to open the modal
    }
    if (consumeNeedsCode()) setOpen(true);
    const handler = () => setOpen(true);
    window.addEventListener("padelpro-needs-code", handler);
    return () => window.removeEventListener("padelpro-needs-code", handler);
  }, []);

  if (!open) return null;

  const save = () => {
    const c = code.trim();
    if (!c) return;
    setAccessCode(c);
    location.reload();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-6 max-w-sm w-full space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔒</span>
          <h2 className="text-lg font-semibold text-white">Código de acesso</h2>
        </div>
        <p className="text-sm text-gray-400">
          Este PadelPro está protegido. Pede o código a quem te partilhou o link e cola-o aqui.
        </p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="código"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={() => setOpen(false)} className="btn-ghost px-4 py-2 text-sm">
            Cancelar
          </button>
          <button onClick={save} className="btn-primary px-4 py-2 text-sm">
            Entrar
          </button>
        </div>
      </div>
    </div>
  );
}
