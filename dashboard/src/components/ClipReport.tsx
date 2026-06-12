"use client";

import Link from "next/link";
import type { ClipReport, PlayerReport } from "@/lib/api";

/** Vertical padel court (10m × 20m) with a player's occupancy heatmap. */
function CourtHeatmap({ p }: { p: PlayerReport }) {
  const rows = p.heatmap.length || 20;
  const cols = p.heatmap[0]?.length || 10;
  const W = 100, L = 200;
  const sl1 = (6.95 / 20) * L;        // far service line
  const sl2 = L - sl1;                // near service line
  return (
    <svg viewBox={`-4 -4 ${W + 8} ${L + 8}`} className="w-full block">
      {p.heatmap.map((row, r) =>
        row.map((v, c) =>
          v > 0.02 ? (
            <rect
              key={`${r}-${c}`}
              x={(c * W) / cols}
              y={(r * L) / rows}
              width={W / cols}
              height={L / rows}
              fill="#1D9E75"
              opacity={0.15 + 0.85 * v}
            />
          ) : null,
        ),
      )}
      <rect x={0} y={0} width={W} height={L} fill="none" stroke="#4b5563" strokeWidth={2} />
      <line x1={0} y1={L / 2} x2={W} y2={L / 2} stroke="#9ca3af" strokeWidth={2.5} />
      <line x1={0} y1={sl1} x2={W} y2={sl1} stroke="#4b5563" strokeWidth={1.2} />
      <line x1={0} y1={sl2} x2={W} y2={sl2} stroke="#4b5563" strokeWidth={1.2} />
      <line x1={W / 2} y1={sl1} x2={W / 2} y2={sl2} stroke="#4b5563" strokeWidth={1.2} />
      {p.mean_pos && (
        <circle
          cx={(p.mean_pos[0] / 10) * W}
          cy={(p.mean_pos[1] / 20) * L}
          r={5}
          fill="#fff"
          stroke="#1D9E75"
          strokeWidth={2.5}
        />
      )}
    </svg>
  );
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
        * Pancadas detetadas pelo som e atribuídas ao jogador com o pico de movimento
        mais forte nesse instante — método experimental, trata os números por jogador
        como aproximações.
      </p>
    </div>
  );
}
