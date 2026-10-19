import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="space-y-1">
      <h1 className="text-3xl font-display">{title}</h1>
      {subtitle && (
        <p className="text-tinta/60 dark:text-creme/60 leading-relaxed">
          {subtitle}
        </p>
      )}
    </header>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "text-petroleo"
      : tone === "negative"
        ? "text-terracota"
        : "text-tinta dark:text-creme";
  return (
    <div className="space-y-1">
      <div className="text-sm text-tinta/60 dark:text-creme/60">{label}</div>
      <div className={`text-3xl font-display tnum ${color}`}>{value}</div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="card p-8 text-center space-y-1">
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm text-tinta/50 dark:text-creme/50">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-tinta/50 dark:text-creme/50 mb-3">
      {children}
    </h2>
  );
}
