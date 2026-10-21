import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { eligible } from "@/lib/month";
import { compactEuros, compareRows, type CompareRow } from "@/lib/meses";
import { addMonth } from "@/lib/forecast";
import { monthName, monthShort } from "@/lib/format";
import { joanaStats } from "@/lib/joanaView";
import { duetByMonth } from "@/lib/planView";
import { lastDayOf, loadDuetReceipts, type DuetReceiptsResult } from "@/data/duet";
import type { MonthsView } from "@/lib/view";

/** At most this many months side by side (the table must fit a phone). */
const MAX_MONTHS = 4;

const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

/** The closed months side by side (sem pontuais) with the averages the plan uses. */
export function MonthCompare({ view, members }: { view: MonthsView; members: { id: string; display_name: string }[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // What Joana received on Duet: the last 12 complete months (the compared
  // ones are among them), averaged as the plan does.
  const current = view.current;
  const [receipts, setReceipts] = useState<DuetReceiptsResult | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDuetReceipts(`${addMonth(current, -12)}-01`, lastDayOf(addMonth(current, -1))).then((r) => alive && setReceipts(r));
    return () => {
      alive = false;
    };
  }, [current]);
  const duet = useMemo(() => {
    if (!receipts?.configured || receipts.error) return null;
    const s = joanaStats(receipts.receipts, current);
    return { byMonth: duetByMonth(receipts.receipts), average: s.average, count: s.months.length };
  }, [receipts, current]);
  const { months, sem, rows } = useMemo(() => {
    const months = view.closed.slice(-MAX_MONTHS);
    const sem = months.map((m) => view.semPontuais.get(m)!);
    const real = months.map((m) => view.real.get(m)!);
    return { months, sem, rows: compareRows(sem, real, view.averages, members, duet) };
  }, [view, members, duet]);
  const hidden = view.closed.length - months.length;
  const notEligible = new Set(sem.filter((b) => !eligible(b)).map((b) => b.month));
  const avgMonths = view.averages.months;
  const outOfAverage = [...notEligible].filter((m) => !avgMonths.includes(m));

  if (months.length === 0) {
    return (
      <div className="card p-5 text-sm text-tinta/60 dark:text-creme/60">
        Ainda não há nenhum mês fechado para comparar. O primeiro mês completo aparece aqui quando acabar.
      </div>
    );
  }

  const cell = (r: CompareRow, i: number) => {
    if (r.pair) {
      const p = r.pair[i];
      if (!p.inn && !p.out) return <span className="text-tinta/30 dark:text-creme/30">—</span>;
      return (
        <span className="block leading-tight">
          {p.inn > 0 && <span className="block text-petroleo">+{compactEuros(p.inn)}</span>}
          {p.out > 0 && <span className="block">−{compactEuros(p.out)}</span>}
        </span>
      );
    }
    const v = r.values[i];
    if (r.kind === "result") return <span className={v < 0 ? "text-terracota" : "text-petroleo"}>{compactEuros(v)}</span>;
    return v === 0 ? <span className="text-tinta/30 dark:text-creme/30">0</span> : compactEuros(v);
  };

  const line = (r: CompareRow, depth: number) => {
    const canOpen = !!r.children?.length;
    const isOpen = !!open[r.key];
    const strong = r.kind === "total" || r.kind === "result";
    const label = (
      <span className={`block break-words leading-tight ${depth ? "pl-2 text-tinta/60 dark:text-creme/60" : r.kind === "sub" ? "pl-2 text-tinta/70 dark:text-creme/70" : ""}`}>
        {r.label}
        {canOpen && <span className="text-tinta/40 dark:text-creme/40"> {isOpen ? "▾" : "▸"}</span>}
      </span>
    );
    return (
      <Fragment key={r.key}>
        <tr className={`border-t border-areia/60 dark:border-white/5 ${r.kind === "result" ? "border-t-2 border-tinta/20 dark:border-creme/20" : ""} ${strong ? "font-medium" : ""} ${depth ? "bg-areia/20 dark:bg-white/[0.02]" : ""}`}>
          <td className="py-1.5 pr-1 align-top">
            {canOpen ? (
              <button className="text-left w-full active:opacity-60" onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}>
                {label}
              </button>
            ) : (
              label
            )}
          </td>
          {months.map((m, i) => (
            <td key={m} className="py-1.5 px-0.5 text-right align-top tnum">
              {cell(r, i)}
            </td>
          ))}
          <td className="py-1.5 pl-0.5 text-right align-top tnum font-semibold">{r.avg == null ? <span className="text-tinta/30 dark:text-creme/30">—</span> : r.kind === "result" ? <span className={r.avg < 0 ? "text-terracota" : "text-petroleo"}>{compactEuros(r.avg)}</span> : compactEuros(r.avg)}</td>
        </tr>
        {canOpen && isOpen && r.children!.map((c) => line(c, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card p-3">
        <table className="w-full table-fixed text-[11px] leading-snug">
          <colgroup>
            <col className="w-[32%]" />
            {months.map((m) => (
              <col key={m} />
            ))}
            <col />
          </colgroup>
          <thead>
            <tr className="text-tinta/50 dark:text-creme/50">
              <th className="text-left font-normal pb-1.5">€ por mês</th>
              {months.map((m) => (
                <th key={m} className="text-right font-semibold pb-1.5 px-0.5">
                  {monthShort(m)}
                  {notEligible.has(m) && "*"}
                </th>
              ))}
              <th className="text-right font-semibold pb-1.5 pl-0.5 text-tinta dark:text-creme">Média</th>
            </tr>
          </thead>
          <tbody>{rows.map((r) => line(r, 0))}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-tinta/50 dark:text-creme/50">
          Sem pontuais (exceto a última linha). Toca em Contas fixas ou Dia a dia para ver as categorias.
        </p>
        {notEligible.size > 0 && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            * ainda com movimentos sem categoria
            {outOfAverage.length > 0 && " — fica fora da média"}.{" "}
            <Link to={`/movimentos?mes=${[...notEligible][0]}&vista=categorizar`} className="underline">
              Categorizar
            </Link>
          </p>
        )}
        {duet && (
          <p className="mt-1 text-[11px] text-tinta/50 dark:text-creme/50">
            Joana na Duet: o que recebeu lá (não soma no Entrou); a média é a do Plano
            {duet.count > 0 && `, de ${duet.count} ${duet.count === 1 ? "mês" : "meses"}`}.{" "}
            <Link to="/meses/joana" className="underline">
              Histórico
            </Link>
          </p>
        )}
        {receipts?.error && <p className="mt-1 text-[11px] text-terracota dark:text-orange-300">Não consegui ver a Duet: {receipts.error}</p>}
        {hidden > 0 && <p className="mt-1 text-[11px] text-tinta/50 dark:text-creme/50">Mostro os últimos {MAX_MONTHS} meses fechados.</p>}
      </div>

      <p className="text-sm text-tinta/60 dark:text-creme/60">
        Média de {avgMonths.length} {avgMonths.length === 1 ? "mês" : "meses"} ({join(avgMonths.map((m) => monthName(m).slice(0, 3)))})
        {view.averages.provisorio && ", ainda com movimentos sem categoria"}. Para médias mais fiáveis, importa extratos antigos em{" "}
        <Link to="/definicoes" className="underline">
          Definições › Avançado
        </Link>
        .
      </p>
      <Link to="/plano#dia-a-dia" className="btn-primary w-full">
        Usar estas médias no Plano →
      </Link>
    </div>
  );
}
