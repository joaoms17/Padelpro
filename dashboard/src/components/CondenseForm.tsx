"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  uploadForCondense,
  getCondenseStatus,
  condenseDownloadUrl,
  type CondenseStatus,
} from "@/lib/api";

function fmtMin(s?: number): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

export function CondenseForm() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<CondenseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const s = await getCondenseStatus(jobId);
      setJob(s);
      if (s.status === "error") setError(s.error || "Falhou.");
    } catch {
      /* ignore transient errors */
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [jobId, poll]);

  const MAX_MB = 150; // free-tier backend ceiling — bigger videos crash it

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      const mb = Math.round(file.size / (1024 * 1024));
      setError(
        `Vídeo demasiado grande (${mb} MB). O servidor gratuito aguenta até ~${MAX_MB} MB ` +
        `(~4 min de 1080p). Usa um clip mais curto, ou processa jogos completos localmente.`,
      );
      return;
    }
    setBusy(true);
    setError("");
    setJob(null);
    setJobId(null);
    try {
      const { job_id } = await uploadForCondense(file);
      setJobId(job_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const done = job?.status === "done";
  const failed = job?.status === "error" || !!error;
  const processing = !!jobId && !done && !failed;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-400">
        Carrega um vídeo e recebes outro só com o <span className="text-gray-200">tempo útil de jogo</span> —
        o tempo morto entre pontos é removido. Passagem rápida (sem deteção).
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Vídeo do jogo</label>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          required
          disabled={processing}
          className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-brand file:text-white file:text-sm file:font-medium hover:file:bg-brand-dark cursor-pointer disabled:opacity-50"
        />
      </div>

      {!done && (
        <button
          type="submit"
          disabled={processing}
          className="w-full py-2.5 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
        >
          {processing ? "A analisar e cortar…" : "✂️ Cortar tempo útil"}
        </button>
      )}

      {processing && (
        <div className="flex items-center gap-3 text-sm text-blue-300">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          A processar — isto pode demorar alguns minutos para vídeos longos…
        </div>
      )}

      {done && job && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Tempo útil" value={fmtMin(job.useful_s)} />
            <Stat label="% do vídeo" value={job.useful_pct != null ? `${job.useful_pct}%` : "—"} />
            <Stat label="Rallies" value={String(job.rallies ?? "—")} />
          </div>
          <a
            href={condenseDownloadUrl(job.job_id)}
            className="block w-full text-center py-2.5 bg-brand hover:bg-brand-dark text-white rounded-lg font-medium text-sm transition-colors"
          >
            ⬇️ Descarregar vídeo (tempo útil)
          </a>
          <button
            type="button"
            onClick={() => { setJobId(null); setJob(null); setBusy(false); if (fileRef.current) fileRef.current.value = ""; }}
            className="block w-full text-center py-2 text-gray-400 hover:text-white text-sm"
          >
            Cortar outro vídeo
          </button>
        </div>
      )}

      {failed && (
        <p className="text-sm text-red-400">{error || job?.error}</p>
      )}
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg py-3">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
