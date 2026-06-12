"use client";

import Link from "next/link";
import type { ClipReport, PlayerReport } from "@/lib/api";
import { HeatmapGrid } from "./HeatmapGrid";

/** Vertical padel court (10m × 20m) with a player's occupancy heatmap. */
function CourtHeatmap({ p }: { p: PlayerReport }) {
  return <HeatmapGrid grid={p.heatmap} marker={p.mean_pos} />;
}

function ZoneBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-gray-400">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-10 text-right text-gray-300">{pct}%</span>
    </div>
  );
}

function Num({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-base font-bold text-white leading-tight whitespace-nowrap">
        {value}
        {unit && <span className="text-xs font-normal text-gray-500"> {unit}</span>}
      </div>
      <div className="text-[11px] text-gray-500 whitespace-nowrap">{label}</div>
    </div>
  );
}

function PlayerCard({ p }: { p: PlayerReport }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <div className="font-semibold text-white whitespace-nowrap">{p.label}</div>
        <div className="text-[11px] text-gray-500 whitespace-nowrap">
          {p.team === "longe" ? "campo de cima" : "campo de baixo"} · {p.side === "esq" ? "esq." : "dir."}
        </div>
      </div>
      <div className="flex gap-4 min-w-0">
        <div className="flex-1 min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Num label="distância" value={p.distance_m} unit="m" />
            <Num label="pancadas*" value={p.hits} />
            <Num label="vel. média" value={p.avg_speed_ms} unit="m/s" />
            <Num label="vel. máx" value={p.max_speed_ms} unit="m/s" />
          </div>
          <div className="space-y-1.5 pt-1">
            <ZoneBar label="Rede" pct={p.zones.rede_pct} color="bg-emerald-500" />
            <ZoneBar label="Meio" pct={p.zones.meio_pct} color="bg-sky-500" />
            <ZoneBar label="Fundo" pct={p.zones.fundo_pct} color="bg-violet-500" />
          </div>
        </div>
        <div className="w-[88px] sm:w-[104px] flex-shrink-0 self-start">
          <CourtHeatmap p={p} />
        </div>
      </div>
      {p.shot_types && Object.keys(p.shot_types).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(p.shot_types).map(([t, n]) => (
            <span
              key={t}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                t === "smash"
                  ? "border-amber-600 text-amber-300"
                  : "border-gray-700 text-gray-400"
              }`}
            >
              {t} ×{n}
            </span>
          ))}
        </div>
      )}
      <div className="text-[11px] text-gray-600">
        cobertura do tracking: {p.coverage_pct}%
      </div>
    </div>
  );
}

export function ClipReportView({ report }: { report: ClipReport }) {
  const maxDur = Math.max(...report.rallies.map((r) => r.dur_s), 1);
  return (
    <div className="space-y-5 pt-2">
      <h3 className="text-lg font-bold text-white">📊 Relatório do clip</h3>

      {!report.calibrated && (
        <div className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
          Campo não calibrado — posições, zonas e velocidades indisponíveis.{" "}
          <Link href="/calibrate" className="underline">Calibrar campo &quot;{report.court_id}&quot;</Link>{" "}
          e volta a analisar.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {[
          ["Tempo útil", `${Math.round(report.clip.useful_s)}s`, `${report.clip.useful_pct}%`],
          ["Rallies", String(report.clip.rallies), ""],
          ["Pancadas", String(report.hits.total), ""],
          ["Pancadas/rally", String(report.hits.avg_per_rally), ""],
        ].map(([l, v, sub]) => (
          <div key={l} className="bg-gray-800 border border-gray-700 rounded-lg py-2.5">
            <div className="text-lg font-bold text-white leading-tight">{v}</div>
            {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
            <div className="text-[11px] text-gray-500">{l}</div>
          </div>
        ))}
      </div>

      {report.players.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {report.players.map((p) => <PlayerCard key={p.id} p={p} />)}
        </div>
      )}

      {report.rallies.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium text-gray-300">Rallies</div>
          {report.rallies.map((r) => (
            <div key={r.i} className="flex items-center gap-2 text-xs">
              <span className="w-8 text-gray-500">#{r.i}</span>
              <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                <div className="h-full bg-brand/70" style={{ width: `${(r.dur_s / maxDur) * 100}%` }} />
              </div>
              <span className="w-24 text-gray-400 text-right">
                {r.dur_s}s · {r.hits} panc.
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-600">
        {report.hits.attribution === "bola" ? (
          <>
            * Pancadas detetadas pelo som; {report.hits.via_ball_pct ?? report.hits.ball_found_pct}%
            atribuídas pela posição da bola no contacto (resto por pico de movimento).
          </>
        ) : (
          <>
            * Pancadas detetadas pelo som e atribuídas ao jogador com o pico de movimento
            mais forte nesse instante — método experimental, trata os números por jogador
            como aproximações.
          </>
        )}
      </p>
    </div>
  );
}
