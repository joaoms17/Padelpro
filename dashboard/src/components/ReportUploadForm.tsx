"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadForReport, uploadUrlForReport } from "@/lib/api";

type Source = "file" | "url";

/**
 * Primary entry point: upload a whole match (file or link) → Gemini analyses
 * the full video → navigate to the report page that polls for the result.
 */
export function ReportUploadForm() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("file");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    try {
      setBusy(true);
      if (source === "url") {
        const link = url.trim();
        if (!/^https?:\/\//.test(link)) {
          setError("Cola um link válido (começa por http).");
          setBusy(false);
          return;
        }
        const { rid } = await uploadUrlForReport(link);
        router.push(`/relatorio/${rid}`);
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setError("Seleciona um ficheiro de vídeo.");
          setBusy(false);
          return;
        }
        const { rid } = await uploadForReport(file);
        router.push(`/relatorio/${rid}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

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
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Vídeo do jogo
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            disabled={busy}
            className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-brand file:text-navy-950 file:text-sm file:font-bold hover:file:bg-brand-dark cursor-pointer disabled:opacity-50"
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Link do vídeo
          </label>
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
        disabled={busy}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2"
      >
        {busy ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            A enviar…
          </>
        ) : (
          "⚡ Analisar jogo"
        )}
      </button>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
