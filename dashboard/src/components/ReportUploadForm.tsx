"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiHealth, uploadForReport, uploadUrlForReport } from "@/lib/api";

type Source = "file" | "url";
type Phase = "idle" | "waking" | "uploading" | "queued";

const MAX_MB_DEFAULT = 500;

export function ReportUploadForm() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("file");
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [fileMB, setFileMB] = useState<number | null>(null);
  const [maxMB, setMaxMB] = useState(MAX_MB_DEFAULT);
  const fileRef = useRef<HTMLInputElement>(null);

  // Probe the server on mount so it wakes from sleep early.
  useEffect(() => {
    getApiHealth().then(() => {
      // try to get the reported upload limit
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "/api/pipeline"}/report/capabilities`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.max_upload_mb) setMaxMB(d.max_upload_mb); })
        .catch(() => {});
    }).catch(() => {});
  }, []);

  const busy = phase !== "idle";
  const oversize = fileMB != null && fileMB > maxMB;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setError("");
    setFileMB(f ? f.size / (1024 * 1024) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    try {
      // Wake-up ping — if the server is sleeping this gives it a head start
      // and surfaces a clear error instead of a generic "Load failed".
      setPhase("waking");
      try {
        await getApiHealth();
      } catch {
        throw new Error(
          "Servidor indisponível. Aguarda 30 segundos e tenta de novo — o servidor pode estar a iniciar."
        );
      }

      setPhase("uploading");

      if (source === "url") {
        const link = url.trim();
        if (!/^https?:\/\//.test(link)) {
          setError("Cola um link válido (começa por http).");
          setPhase("idle");
          return;
        }
        const { rid } = await uploadUrlForReport(link);
        setPhase("queued");
        router.push(`/relatorio/${rid}`);
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setError("Seleciona um ficheiro de vídeo.");
          setPhase("idle");
          return;
        }
        if (file.size > maxMB * 1024 * 1024) {
          setError(
            `Ficheiro demasiado grande (${Math.round(file.size / (1024 * 1024))} MB). ` +
            `Máximo: ${maxMB} MB. Exporta em 720p e tenta de novo.`
          );
          setPhase("idle");
          return;
        }
        const { rid } = await uploadForReport(file);
        setPhase("queued");
        router.push(`/relatorio/${rid}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.toLowerCase().includes("load failed") || msg.toLowerCase().includes("failed to fetch")
          ? "Não foi possível chegar ao servidor. Verifica a ligação e tenta de novo — o servidor pode demorar ~30 s a iniciar."
          : msg
      );
      setPhase("idle");
    }
  }

  const phaseLabel: Record<Phase, string> = {
    idle: "⚡ Analisar jogo",
    waking: "A verificar servidor…",
    uploading: "A enviar vídeo…",
    queued: "Na fila…",
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-full p-1 w-fit">
        {([["file", "📁 Do PC"], ["url", "🔗 Link / YouTube"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            disabled={busy}
            onClick={() => { setSource(key); setError(""); }}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
              source === key ? "bg-brand text-navy-950" : "text-gray-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "file" ? (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="block text-sm font-medium text-gray-300">Vídeo do jogo</label>
            <span className={`text-xs ${oversize ? "text-red-400" : "text-gray-500"}`}>
              máx. {maxMB} MB
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={onPick}
            className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-brand file:text-navy-950 file:text-sm file:font-bold hover:file:bg-brand-dark cursor-pointer disabled:opacity-50"
          />
          {fileMB != null && (
            <p className={`text-xs mt-1 ${oversize ? "text-red-400" : "text-gray-500"}`}>
              {Math.round(fileMB)} MB {oversize ? "— acima do limite, exporta em 720p" : ""}
            </p>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Link do vídeo</label>
          <input
            type="url"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            disabled={busy}
            onChange={(e) => { setUrl(e.target.value); setError(""); }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-brand outline-none disabled:opacity-50"
          />
          <p className="text-xs text-gray-500 mt-1">
            YouTube ou link direto. Se o YouTube bloquear o servidor, carrega o ficheiro do PC.
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || oversize}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {busy && (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {phaseLabel[phase]}
      </button>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
