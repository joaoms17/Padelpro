import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui";

/** A screen still being built (delivered in steps). */
export function EmBreve({ title, what }: { title: string; what: string }) {
  return (
    <div className="space-y-5">
      <div className="pr-12">
        <PageHeader title={title} />
      </div>
      <div className="card p-5 space-y-3">
        <p className="font-medium">Chega na próxima entrega.</p>
        <p className="text-sm text-tinta/60 dark:text-creme/60">{what}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/meses" className="btn-ghost text-sm px-4 py-2">Ver os meses</Link>
          <Link to="/movimentos" className="btn-ghost text-sm px-4 py-2">Categorizar movimentos</Link>
        </div>
      </div>
    </div>
  );
}
