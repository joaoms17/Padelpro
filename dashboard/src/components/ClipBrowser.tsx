"use client";

import { useState, useEffect } from "react";
import { queryClips, requestMontage, getMontageStatus, montageDownloadUrl, type Clip } from "@/lib/api";
import { formatMs, STROKE_LABELS, ZONE_LABELS } from "@/lib/utils";

const STROKES = ["", ...Object.keys(STROKE_LABELS)];
const ZONES   = ["", "net_left", "net_right", "mid_left", "mid_right", "back_left", "back_right"];
const PHASES  = ["", "early", "mid", "late"];

export function ClipBrowser({ matchId }: { matchId: string }) {
  const [clips,       setClips]       = useState<Clip[]>([]);
  const [filters,     setFilters]     = useState({ player_id: "", stroke: "", zone: "", rally_phase: "" });
  const [loading,     setLoading]     = useState(false);
  const [montageJob,  setMontageJob]  = useState<string | null>(null);
  const [montageStatus, setMontageStatus] = useState("");

  useEffect(() => { fetchClips(); }, [filters]);

  async function fetchClips() {
    setLoading(true);
    try {
      const f: Record<string, string | number> = {};
      if (filters.player_id)  f.player_id   = Number(filters.player_id);
      if (filters.stroke)     f.stroke       = filters.stroke;
      if (filters.zone)       f.zone         = filters.zone;
      if (filters.rally_phase) f.rally_phase = filters.rally_phase;
      const data = await queryClips(matchId, f as Parameters<typeof queryClips>[1]);
      setClips(data);
    } catch {
      setClips([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMontage() {
    try {
      const f: Record<string, string | number> = {};
      if (filters.player_id)  f.player_id   = Number(filters.player_id);
      if (filters.stroke)     f.stroke       = filters.stroke;
      if (filters.zone)       f.zone         = filters.zone;
      if (filters.rally_phase) f.rally_phase = filters.rally_phase;
      const { job_id } = await requestMontage(matchId, f as Parameters<typeof requestMontage>[1]);
      setMontageJob(job_id);
      setMontageStatus("A gerar…");
      poll(job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMontageStatus(`Erro: ${msg}`);
    }
  }

  function poll(job_id: string) {
    const iv = setInterval(async () => {
      const { status } = await getMontageStatus(job_id);
      setMontageStatus(status);
      if (status === "done" || status === "error") clearInterval(iv);
    }, 2000);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select label="Jogador" value={filters.player_id}
                onChange={(v) => setFilters({ ...filters, player_id: v })}
                options={["", "1", "2", "3", "4"].map((v) => ({ value: v, label: v ? `P${v}` : "Todos" }))} />
        <Select label="Pancada" value={filters.stroke}
                onChange={(v) => setFilters({ ...filters, stroke: v })}
                options={STROKES.map((s) => ({ value: s, label: s ? (STROKE_LABELS[s] ?? s) : "Todas" }))} />
        <Select label="Zona" value={filters.zone}
                onChange={(v) => setFilters({ ...filters, zone: v })}
                options={ZONES.map((z) => ({ value: z, label: z ? (ZONE_LABELS[z] ?? z) : "Todas" }))} />
        <Select label="Fase" value={filters.rally_phase}
                onChange={(v) => setFilters({ ...filters, rally_phase: v })}
                options={PHASES.map((p) => ({ value: p, label: p ? p[0].toUpperCase() + p.slice(1) : "Todas" }))} />
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">
          {loading ? "A carregar…" : `${clips.length} clips`}
        </span>
        {clips.length > 0 && (
          <div className="flex items-center gap-3">
            {montageJob && montageStatus === "done" && (
              <a href={montageDownloadUrl(montageJob)}
                 className="text-brand hover:underline text-sm font-medium" download>
                ⬇ Descarregar montagem
              </a>
            )}
            {montageStatus && montageStatus !== "done" && (
              <span className="text-gray-400 text-xs">{montageStatus}</span>
            )}
            <button
              onClick={handleMontage}
              className="px-3 py-1.5 bg-brand hover:bg-brand-dark text-navy-950 rounded-lg text-sm font-bold transition-colors"
            >
              Montar seleção
            </button>
          </div>
        )}
      </div>

      {/* Clip grid */}
      <div className="space-y-2">
        {clips.slice(0, 50).map((clip) => (
          <ClipRow key={clip.clip_id} clip={clip} />
        ))}
        {clips.length > 50 && (
          <p className="text-xs text-gray-500">+{clips.length - 50} clips adicionais</p>
        )}
      </div>
    </div>
  );
}

function ClipRow({ clip }: { clip: Clip }) {
  return (
    <div className="flex items-center gap-4 bg-gray-800 rounded-lg px-4 py-3 text-sm">
      <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
        P{clip.player_id}
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-white">{STROKE_LABELS[clip.stroke_type] ?? clip.stroke_type}</span>
        <span className="mx-2 text-gray-600">·</span>
        <span className="text-gray-400">{ZONE_LABELS[clip.zone] ?? clip.zone}</span>
        <span className="mx-2 text-gray-600">·</span>
        <span className="text-gray-500 text-xs">{clip.rally_phase}</span>
      </div>
      <div className="text-gray-500 text-xs font-mono flex-shrink-0">
        {formatMs(clip.t_start_ms)} – {formatMs(clip.t_end_ms)}
      </div>
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
