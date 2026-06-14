"use client";

import { useState, useRef } from "react";
import { createMatch, uploadVideo, runPipeline } from "@/lib/api";
import { useRouter } from "next/navigation";

export function UploadForm() {
  const [courtId,   setCourtId]   = useState("sintra_court1");
  const [segment,   setSegment]   = useState(true);
  const [analytics, setAnalytics] = useState(true);
  const [supabase,  setSupabase]  = useState(true);
  const [status,    setStatus]    = useState("");
  const [loading,   setLoading]   = useState(false);
  const fileRef  = useRef<HTMLInputElement>(null);
  const router   = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      setStatus("A registar jogo…");
      const { match_id } = await createMatch(courtId);

      setStatus("A enviar vídeo…");
      await uploadVideo(match_id, file);

      setStatus("A iniciar pipeline…");
      await runPipeline(match_id, {
        segment, condense: segment, pose: analytics, analytics, supabase,
      });

      router.push(`/matches/${match_id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Erro: ${message}`);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Campo</label>
        <input
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          value={courtId}
          onChange={(e) => setCourtId(e.target.value)}
          placeholder="sintra_court1"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Vídeo do jogo</label>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          required
          className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-brand file:text-navy-950 file:text-sm file:font-bold hover:file:bg-brand-dark cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <Toggle label="Segmentação (cortar tempo morto)" checked={segment}   onChange={setSegment} />
        <Toggle label="Analytics + heatmaps"              checked={analytics} onChange={setAnalytics} />
        <Toggle label="Guardar no Supabase"                checked={supabase}  onChange={setSupabase} />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 bg-brand hover:bg-brand-dark disabled:opacity-50 text-navy-950 rounded-full font-bold text-sm transition-colors"
      >
        {loading ? "A processar…" : "Analisar jogo"}
      </button>

      {status && <p className="text-xs text-gray-400">{status}</p>}
    </form>
  );
}

function Toggle({
  label, checked, onChange,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-brand" : "bg-gray-600"}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </div>
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}
