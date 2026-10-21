// Small building blocks shared by the screens (Este mês, Meses, Plano, Movimentos).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatEuros } from "@/lib/format";

/** An amount to the euro; `signed` adds "+"/"−", `tone` colours it. */
export function Eur({
  cents,
  signed = false,
  tone = "none",
  className = "",
}: {
  cents: number;
  signed?: boolean;
  tone?: "none" | "auto" | "pos" | "neg";
  className?: string;
}) {
  const t = tone === "auto" ? (cents < 0 ? "neg" : "pos") : tone;
  const color = t === "pos" ? "text-petroleo" : t === "neg" ? "text-terracota" : "";
  const text = signed
    ? `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${formatEuros(Math.abs(cents))}`
    : formatEuros(cents).replace("-", "−");
  return <span className={`tnum ${color} ${className}`}>{text}</span>;
}

export function Pill({ tone = "grey", children }: { tone?: "green" | "amber" | "grey" | "red"; children: ReactNode }) {
  const cls = {
    green: "bg-petroleo/10 text-petroleo",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    grey: "bg-tinta/5 text-tinta/60 dark:bg-white/10 dark:text-creme/60",
    red: "bg-terracota/10 text-terracota",
  }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** A row of choices (only one active). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-areia dark:border-white/10 overflow-hidden text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 ${value === o.value ? "bg-tinta text-creme dark:bg-creme dark:text-tinta" : "text-tinta/60 dark:text-creme/60"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A filter/selection chip. */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm border transition-colors ${
        active
          ? "bg-tinta text-creme border-tinta dark:bg-creme dark:text-tinta dark:border-creme"
          : "border-areia dark:border-white/10 text-tinta/70 dark:text-creme/70"
      }`}
    >
      {children}
    </button>
  );
}

/** A titled block of a screen (with an anchor for links like /plano#mesadas). */
export function Section({ id, title, right, children }: { id?: string; title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tinta/50 dark:text-creme/50">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Label … amount, on one line. */
export function Row({
  label,
  sub,
  right,
  strong = false,
  muted = false,
  to,
  onClick,
}: {
  label: ReactNode;
  sub?: ReactNode;
  right: ReactNode;
  strong?: boolean;
  muted?: boolean;
  to?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="min-w-0">
        <span className={`block truncate ${strong ? "font-semibold" : ""}`}>{label}</span>
        {sub && <span className="block text-xs text-tinta/50 dark:text-creme/50 truncate">{sub}</span>}
      </span>
      <span className={`shrink-0 text-right ${strong ? "font-semibold" : ""}`}>{right}</span>
    </>
  );
  const cls = `flex items-start justify-between gap-3 py-1.5 ${muted ? "text-tinta/60 dark:text-creme/60" : ""}`;
  if (to) return <Link to={to} className={`${cls} active:opacity-60`}>{inner}</Link>;
  if (onClick) return <button onClick={onClick} className={`${cls} w-full text-left active:opacity-60`}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

/** Progress against a limit; `tick` (0–1) marks where the month is. */
export function Bar({ value, max, tick, level = "ok" }: { value: number; max: number; tick?: number; level?: "ok" | "warn" | "over" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = level === "over" ? "bg-terracota" : level === "warn" ? "bg-amber-500" : "bg-petroleo";
  return (
    <div className="relative h-2 rounded-full bg-areia/70 dark:bg-white/10 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      {tick != null && <div className="absolute top-0 h-full w-0.5 bg-tinta/40 dark:bg-creme/50" style={{ left: `${Math.min(100, tick * 100)}%` }} />}
    </div>
  );
}

export const AREA_COLORS = {
  fixa: "#2E6B66",
  dia: "#A64B25",
  trabalho: "#C99A3B",
  voces: "#6B5B95",
  sem: "#9AA3A6",
} as const;

/** One bar split into parts (where the money went). */
export function StackedBar({ parts }: { parts: { key: string; label: string; cents: number; color: string }[] }) {
  const shown = parts.filter((p) => p.cents > 0);
  const total = shown.reduce((a, p) => a + p.cents, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden">
        {shown.map((p) => (
          <div key={p.key} style={{ width: `${(p.cents / total) * 100}%`, background: p.color }} title={p.label} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-tinta/60 dark:text-creme/60">
        {shown.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.label} <Eur cents={p.cents} /> · {Math.round((p.cents / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/** Loading / error states for a screen that reads the engine data. */
export function Loading({ error }: { error?: string | null }) {
  if (error) return <p className="py-10 text-center text-sm text-terracota">Não consegui carregar: {error}</p>;
  return <div className="py-10 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>;
}
