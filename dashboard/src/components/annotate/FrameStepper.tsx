"use client";

/**
 * Progress header for the per-frame annotation flow: "Frame i de N",
 * a progress bar, a clickable dot strip showing which frames are done,
 * and previous/next controls (keyboard ←/→ handled by the parent page).
 */
export function FrameStepper({
  index,
  total,
  doneFlags,
  onPrev,
  onNext,
  onJump,
}: {
  index: number;
  total: number;
  doneFlags: boolean[];
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
}) {
  const doneCount = doneFlags.filter(Boolean).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="card p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-gray-200">
            Frame <span className="text-brand">{index + 1}</span> de {total}
          </span>
          <span className="text-xs text-gray-500">{doneCount} validados</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onPrev}
            disabled={index <= 0}
            className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
            aria-label="Frame anterior"
          >
            ←
          </button>
          <span className="text-xs text-gray-500 hidden sm:inline">
            <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd>
          </span>
          <button
            onClick={onNext}
            disabled={index >= total - 1}
            className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
            aria-label="Frame seguinte"
          >
            →
          </button>
        </div>
      </div>

      {/* progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-brand transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* dot strip */}
      <div className="flex flex-wrap gap-1.5">
        {doneFlags.map((done, i) => {
          const current = i === index;
          return (
            <button
              key={i}
              onClick={() => onJump(i)}
              title={`Frame ${i + 1}${done ? " — validado" : ""}`}
              className={`h-2.5 w-2.5 rounded-full transition-all ${
                current
                  ? "ring-2 ring-brand ring-offset-2 ring-offset-navy-900 " +
                    (done ? "bg-brand" : "bg-gray-300")
                  : done
                    ? "bg-brand/70 hover:bg-brand"
                    : "bg-gray-700 hover:bg-gray-600"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
