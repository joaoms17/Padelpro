"use client";

/**
 * Horizontal segmented progress bar for the model-progression levels.
 * One segment per threshold (5). Segments up to `level` glow teal; the rest
 * stay navy/gray. Threshold numbers sit under each boundary and a thin marker
 * shows where the current `count` lands.
 */
export function LevelMeter({
  count,
  thresholds,
  level,
}: {
  count: number;
  thresholds: number[];
  level: number;
}) {
  const segments = thresholds.length || 1;
  const maxThreshold = thresholds[thresholds.length - 1] || 1;

  // Position of the live "count" marker across the full bar (clamped 0..100).
  const markerPct = Math.max(0, Math.min(100, (count / maxThreshold) * 100));

  return (
    <div className="w-full">
      {/* Segmented bar */}
      <div className="relative flex gap-1.5">
        {thresholds.map((_, i) => {
          const filled = i < level;
          return (
            <div
              key={i}
              className={[
                "h-3 flex-1 rounded-full transition-all duration-500",
                filled
                  ? "bg-gradient-to-r from-brand to-brand-light shadow-[0_0_12px_rgba(0,224,164,0.45)]"
                  : "bg-navy-800 border border-gray-800",
              ].join(" ")}
            />
          );
        })}

        {/* Live count marker */}
        <div
          className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 rounded-full bg-accent shadow-[0_0_8px_rgba(232,255,61,0.7)]"
          style={{ left: `calc(${markerPct}% - 1px)` }}
          aria-hidden
        />
      </div>

      {/* Threshold numbers under each boundary */}
      <div className="mt-1.5 flex gap-1.5">
        {thresholds.map((t, i) => (
          <div
            key={i}
            className={[
              "flex-1 text-center text-[10px] tabular-nums",
              i < level ? "text-brand-light font-semibold" : "text-gray-500",
            ].join(" ")}
          >
            {t}
          </div>
        ))}
      </div>

      <span className="sr-only">
        {count} de {maxThreshold} amostras, nível {level} de {segments}
      </span>
    </div>
  );
}
