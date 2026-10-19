import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui";

// Shown for screens whose data lands in a later milestone, so the shell is
// navigable end-to-end from M1 while the features are built in order.
export function Stub({
  title,
  subtitle,
  milestone,
  points,
}: {
  title: string;
  subtitle?: string;
  milestone: string;
  points: string[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="card p-5 space-y-3">
        <span className="inline-block text-xs font-semibold uppercase tracking-wide text-petroleo bg-petroleo/10 rounded-full px-3 py-1">
          Chega em {milestone}
        </span>
        <ul className="space-y-1.5 text-sm text-tinta/70 dark:text-creme/70">
          {points.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="text-terracota">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <Link to="/" className="btn-ghost text-sm">
          ← Início
        </Link>
      </div>
    </div>
  );
}
