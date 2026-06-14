"use client";

import type { ReactNode } from "react";

/**
 * One step in the per-frame "O que preciso nesta imagem" checklist.
 * Shows a check/pending indicator + title, with the inputs as children.
 */
export function ChecklistItem({
  step,
  title,
  done,
  hint,
  children,
}: {
  step: number;
  title: string;
  done: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-gray-800 bg-navy-900/40 p-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors ${
            done
              ? "bg-brand text-navy-950"
              : "border border-gray-600 text-gray-400"
          }`}
          aria-hidden
        >
          {done ? "✓" : step}
        </span>
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        {done && (
          <span className="ml-auto text-xs font-medium text-brand">feito</span>
        )}
      </div>
      {hint && <p className="pl-8 text-xs text-gray-500">{hint}</p>}
      <div className="pl-0">{children}</div>
    </div>
  );
}
