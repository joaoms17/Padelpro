"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  uploadForCondense,
  getCondenseStatus,
  getCondenseCapabilities,
  condenseDownloadUrl,
  type CondenseStatus,
} from "@/lib/api";
import { ClipReportView } from "@/components/ClipReport";

const MAX_MB = 150; // free-tier backend ceiling — bigger videos crash it

function fmtMin(s?: number): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

function Spinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
  );
}

export function CondenseForm() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<CondenseStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileMB, setFileMB] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [canAnalyze, setCanAnalyze] = useState(false);
  const [analyze, setAnalyze] = useState(false);
  const [courtId, setCourtId] = useState("court1");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCondenseCapabilities()
      .then((c) => setCanAnalyze(!!c.analyze))
      .catch(() => setCanAnalyze(false));
  }, []);

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

  const done = job?.status === "done";
  const failed = job?.status === "error" || !!error;

  useEffect(() => {
    if (!jobId || done || failed) return;
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [jobId, poll, done, failed]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setError("");
    setFileMB(f ? f.size / (1024 * 1024) : null);
  }

  const oversize = fileMB != null && fileMB > MAX_MB;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(
        `Vídeo demasiado grande (${Math.round(fileMB!)} MB). O servidor gratuito aguenta até ~${MAX_MB} MB ` +
        `(~4 min de 1080p). Usa um clip mais curto, ou processa jogos completos localmente.`,
      );
      return;
    }
    setError("");
    setJob(null);
    setJobId(null);
    setUploading(true);
    try {
      const { job_id } = await uploadForCondense(file, { analyze, courtId });
      setJobId(job_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  const analysing = !!jobId && !done && !failed;
  const busy = uploading || analysing;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-400">
        Carrega um vídeo e recebes outro só com o <span className="text-gray-200">tempo útil de jogo</span> —
        o tempo morto entre pontos é removido.
      </p>

      <div>
        <div className="flex items-baseline justify-between mb-1">
          <label className="block text-sm font-medium text-gray-300">Vídeo do jogo</label>
          <span className={`text-xs ${oversize ? "text-red-400" : "text-gray-500"}`}>
            máx. {MAX_MB} MB (~4 min)
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          required
          disabled={busy}
          onChange={onPick}
          className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-brand file:text-white file:text-sm file:font-medium hover:file:bg-brand-dark cursor-pointer disabled:opacity-50"
        />
        {fileMB != null && (
          <p className={`text-xs mt-1 ${oversize ? "text-red-400" : "text-green-400"}`}>
            Selecionado: {Math.round(fileMB)} MB {oversize && "— acima do limite"}
          </p>
        )}
      </div>

      {canAnalyze && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={analyze}
              disabled={busy}
              onChange={(e) => setAnalyze(e.target.checked)}
              className="accent-emerald-500 w-4 h-4"
            />
            <span>
              📊 Analisar jogadores <span className="text-gray-500">(beta — distâncias, zonas, heatmap, pancadas)</span>
            </span>
          </label>
          {analyze && (
            <div className="flex items-center gap-2 text-xs text-gray-400 pl-6">
              <span>Campo:</span>
              <input
                value={courtId}
                disabled={busy}
                onChange={(e) => setCourtId(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white w-28"
              />
              <Link href="/calibrate" className="underline text-gray-500 hover:text-gray-300">
                calibrar primeiro
              </Link>
            </div>
          )}
        </div>
      )}

      {!done && (
        <button
          type="submit"
          disabled={busy || oversize}
          className="w-full py-2.5 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
        >
          {uploading && <><Spinner /> A enviar vídeo…</>}
          {analysing && <><Spinner /> A processar…</>}
          {!busy && "✂️ Cortar tempo útil"}
        </button>
      )}

      {uploading && (
        <div className="flex items-center gap-3 text-sm text-blue-300">
          <Spinner /> A enviar o vídeo para o servidor…
        </div>
      )}

      {analysing && (
        <div className="flex items-center gap-3 text-sm text-blue-300">
          <Spinner />
          <span>
            {job?.phase ? `Fase: ${job.phase}` : "A analisar"}
            {job?.phase === "análise de jogadores" && job?.progress != null && ` (${job.progress}%)`}
            {" — pode demorar alguns minutos…"}
          </span>
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
            onClick={() => { setJobId(null); setJob(null); setFileMB(null); if (fileRef.current) fileRef.current.value = ""; }}
            className="block w-full text-center py-2 text-gray-400 hover:text-white text-sm"
          >
            Cortar outro vídeo
          </button>

          {job.report_error && (
            <p className="text-sm text-yellow-400">{job.report_error}</p>
          )}
          {job.report && <ClipReportView report={job.report} />}
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
