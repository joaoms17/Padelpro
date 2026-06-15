import type { CutTimelineData } from "@/lib/api";

// Brand v2 colours (SVG fills can't use Tailwind classes).
const TEAL = "#00E0A4";      // kept (rally)
const NAVY = "#173654";      // cut (dead time)
const BLUE = "#54A7FF";      // play-score curve
const SLATE = "#9EB3C7";     // threshold lines

const ENTER = 0.8;           // mirror segmentation.get_active_segments defaults
const EXIT = 0.55;

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Diagnostic timeline of the dead-time cut: the per-second "play score" curve
 * with the kept (rally) spans in teal over a cut (grey) baseline. Lets us SEE
 * why the cut kept/removed each second before tuning the thresholds.
 */
export function CutTimeline({ cut }: { cut?: CutTimelineData | null }) {
  if (!cut || !cut.play_score?.length) return null;
  const { duration_s, play_score, segments } = cut;

  const n = play_score.length;
  const totalMs = (duration_s || n) * 1000;
  const W = 1000;
  const scoreTop = 10, scoreH = 54, bandTop = 72, bandH = 18;

  const rallies = segments.filter((s) => s.type === "rally");
  const keptMs = rallies.reduce((a, s) => a + (s.end_ms - s.start_ms), 0);
  const keptPct = totalMs ? Math.round((keptMs / totalMs) * 100) : 0;

  const xMs = (ms: number) => (ms / totalMs) * W;
  const yScore = (v: number) => scoreTop + scoreH - Math.max(0, Math.min(1, v)) * scoreH;

  const curve = play_score
    .map((v, i) => `${((i / Math.max(1, n - 1)) * W).toFixed(1)},${yScore(v).toFixed(1)}`)
    .join(" ");

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-200">✂️ Como ficou o corte</span>
        <span className="text-xs text-gray-500">
          {fmt(duration_s)} original · {fmt(keptMs / 1000)} guardado ({keptPct}%) · {rallies.length} rallies
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${bandTop + bandH}`} preserveAspectRatio="none" className="w-full" style={{ height: 96 }}>
        {/* threshold reference lines */}
        <line x1="0" x2={W} y1={yScore(ENTER)} y2={yScore(ENTER)} stroke={SLATE} strokeWidth="1" strokeDasharray="4 4" opacity="0.35" />
        <line x1="0" x2={W} y1={yScore(EXIT)} y2={yScore(EXIT)} stroke={SLATE} strokeWidth="1" strokeDasharray="4 4" opacity="0.25" />

        {/* play-score curve */}
        <polyline points={curve} fill="none" stroke={BLUE} strokeWidth="1.2" opacity="0.85" />

        {/* band baseline: everything is "cut" until proven kept */}
        <rect x="0" y={bandTop} width={W} height={bandH} rx="3" fill={NAVY} />
        {/* kept (rally) spans */}
        {rallies.map((s, i) => (
          <rect
            key={i}
            x={xMs(s.start_ms)}
            y={bandTop}
            width={Math.max(1, xMs(s.end_ms) - xMs(s.start_ms))}
            height={bandH}
            rx="3"
            fill={TEAL}
          />
        ))}
      </svg>

      <div className="flex items-center justify-between text-[11px] text-gray-600">
        <span>0:00</span>
        <span>{fmt(duration_s)}</span>
      </div>

      <p className="text-[11px] text-gray-500 leading-relaxed">
        <span style={{ color: TEAL }}>■</span> guardado (jogo) ·{" "}
        <span style={{ color: NAVY }}>■</span> cortado ·{" "}
        <span style={{ color: BLUE }}>▬</span> &quot;nota de jogo&quot; por segundo.
        As linhas tracejadas são os limites: acima da de cima começa a guardar, abaixo da de baixo corta.
        Se a nota andar sempre alta (ou aos saltos sem relação com o jogo), o sinal não está a distinguir jogo de tempo morto.
      </p>
    </div>
  );
}
