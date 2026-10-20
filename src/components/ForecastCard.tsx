import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui";
import { formatCents } from "@/lib/format";
import type { MetricsBundle } from "@/data/metrics";

const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function endOfMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${new Date(y, m, 0).getDate()} de ${MES_LONGO[m - 1]}`;
}

const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** The end-of-month forecast, front and centre, with what is behind it. */
export function ForecastCard({ m }: { m: MetricsBundle }) {
  const [open, setOpen] = useState(false);
  const f = m.forecast;
  const inSum = f.incoming.reduce((a, l) => a + l.cents, 0);
  const outSum = f.outgoing.reduce((a, l) => a + l.cents, 0);
  const negative = f.endCents < 0;
  const noIncomes = m.incomes.length === 0;
  const duetToReceive = (m.duetMonthEvents ?? []).filter((e) => e.missing_cents > 0);

  return (
    <Card className="bg-petroleo/5 border-petroleo/20">
      <div className="space-y-1">
        <div className="text-sm text-tinta/60 dark:text-creme/60">
          Previsão para {endOfMonthLabel(m.month)}
        </div>
        <div className={`text-5xl font-display tnum ${negative ? "text-terracota" : "text-petroleo"}`}>
          {formatCents(f.endCents)}
        </div>
        <p className="text-sm text-tinta/60 dark:text-creme/60 tnum">
          Hoje {formatCents(f.balanceCents)} · entra {formatCents(inSum)} · sai {formatCents(outSum)}
        </p>
      </div>

      <button
        className="mt-3 text-sm text-petroleo font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Esconder as contas" : "Ver as contas"}
      </button>

      {open && (
        <div className="mt-3 space-y-1 text-sm">
          <Row label="Saldo hoje" cents={f.balanceCents} />
          {f.incoming.map((l) => (
            <div key={l.key}>
              <Row label={l.label} detail={l.detail} cents={l.cents} sign="+" />
              {l.key === "duet" && duetToReceive.length > 0 && (
                <ul className="pl-4 pb-1 space-y-0.5 text-xs text-tinta/50 dark:text-creme/50">
                  {duetToReceive.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3">
                      <span className="truncate">
                        {shortDate(e.date)} · {e.title}
                        {e.project ? ` · ${e.project}` : ""}
                      </span>
                      <span className="tnum shrink-0">{formatCents(e.missing_cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {f.outgoing.map((l) => (
            <Row key={l.key} label={l.label} detail={l.detail} cents={l.cents} sign="−" />
          ))}
          <div className="border-t border-areia/60 dark:border-white/10 pt-1.5">
            <Row label={`Previsão a ${endOfMonthLabel(m.month)}`} cents={f.endCents} strong />
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1 text-xs text-tinta/50 dark:text-creme/50">
        {noIncomes ? (
          <p>
            <Link to="/entradas-previstas" className="text-petroleo font-medium">
              Diz à app o que costuma entrar →
            </Link>{" "}
            ordenado, despesas de representação, renda…
          </p>
        ) : (
          <p>
            <Link to="/entradas-previstas" className="text-petroleo">
              Entradas previstas →
            </Link>
          </p>
        )}
        {m.duetMonthEvents == null && (
          <p>
            Eventos da Joana: só os registados aqui
            {m.duetError ? ` (app Duet: ${m.duetError})` : " — a app Duet ainda não está ligada"}.
          </p>
        )}
      </div>
    </Card>
  );
}

function Row({
  label,
  detail,
  cents,
  sign,
  strong,
}: {
  label: string;
  detail?: string;
  cents: number;
  sign?: "+" | "−";
  strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span className="min-w-0">
        {sign && <span className="text-tinta/40 dark:text-creme/40">{sign} </span>}
        {label}
        {detail && <span className="block text-xs font-normal text-tinta/50 dark:text-creme/50">{detail}</span>}
      </span>
      <span className={`tnum shrink-0 ${sign === "−" ? "text-terracota" : ""}`}>
        {sign === "−" ? `−${formatCents(cents)}` : formatCents(cents)}
      </span>
    </div>
  );
}
