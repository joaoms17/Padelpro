// The first look of Este mês: the account's balance now and over the last
// months, what the two of you took, and (quietly) whether Joana's Duet money
// is all in the account.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bar, Eur } from "@/components/kit";
import { compactEuros, type JoanaGap } from "@/lib/meses";
import { VOCES_MARK, balanceChange, type BalancePoint, type OwedStatus, type VocesPoint } from "@/lib/resumo";
import { formatEuros } from "@/lib/format";

const muted = "text-tinta/60 dark:text-creme/60";
const faint = "text-tinta/50 dark:text-creme/50";
const POS = "text-petroleo dark:text-teal-300";
const NEG = "text-terracota dark:text-orange-300";

export function SaldoCard({ balance, series, prevLabel }: { balance: number | null; series: BalancePoint[]; prevLabel: string | null }) {
  if (balance == null) {
    return (
      <section className="card p-5 text-sm">
        <p className={muted}>
          Ainda sem saldo do banco.{" "}
          <Link to="/ligar-banco" className="font-medium text-petroleo dark:text-teal-300">
            Ligar o banco →
          </Link>
        </p>
      </section>
    );
  }
  const change = balanceChange(series);
  const max = Math.max(1, ...series.map((p) => Math.abs(p.cents)));
  return (
    <section className="card p-5">
      <p className={`text-sm ${muted}`}>Saldo da conta</p>
      <p className={`text-5xl font-display tnum leading-tight ${balance < 0 ? NEG : ""}`}>
        <Eur cents={balance} />
      </p>
      {change != null && prevLabel && (
        <p className={`mt-1 text-sm ${change < 0 ? NEG : POS}`}>
          {change < 0 ? "▼" : "▲"} <Eur cents={Math.abs(change)} /> <span className={muted}>desde o fim de {prevLabel}</span>
        </p>
      )}
      {series.length > 1 && (
        <Link to="/meses/comparar" className="mt-5 flex items-end gap-2 active:opacity-60" aria-label="Saldo no fim de cada mês">
          {series.map((p) => (
            <div key={p.month} className="min-w-0 flex-1 text-center">
              <div className={`text-[11px] tnum truncate ${p.current ? "font-semibold" : faint}`}>{compactEuros(p.cents)}</div>
              <div className="mt-1 h-20 flex items-end">
                <div
                  className={`w-full rounded-t-lg ${p.cents < 0 ? "bg-terracota" : p.current ? "bg-petroleo" : "bg-petroleo/30 dark:bg-teal-300/25"}`}
                  style={{ height: `${Math.max(4, (Math.abs(p.cents) / max) * 100)}%` }}
                />
              </div>
              <div className={`mt-1 text-[11px] ${p.current ? "font-semibold" : faint}`}>{p.label}</div>
            </div>
          ))}
        </Link>
      )}
    </section>
  );
}

/** What the two of you took this month against the 1 000 € mark, and the months before. */
export function VocesCard({ series, month }: { series: VocesPoint[]; month: string }) {
  const now = series[series.length - 1];
  if (!now) return null;
  const before = series.slice(0, -1).reverse();
  return (
    <Link to={`/meses/${month}`} className={`card p-4 block active:opacity-60 ${now.over ? "border-terracota/40 bg-terracota/5" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Tirámos os dois</span>
        <span className={`text-xs ${now.over ? NEG : POS}`}>{now.over ? `${formatEuros(VOCES_MARK)} ou mais` : `abaixo de ${formatEuros(VOCES_MARK)}`}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className={`text-3xl font-display tnum ${now.over ? NEG : ""}`}>
          <Eur cents={now.cents} />
        </span>
        <span className={`text-xs tnum ${faint}`}>este mês</span>
      </div>
      <div className="mt-2">
        <Bar value={now.cents} max={VOCES_MARK} level={now.over ? "over" : "ok"} />
      </div>
      {before.length > 0 && (
        <div className="mt-3 flex gap-2">
          {before.map((p) => (
            <span key={p.month} className={`flex-1 rounded-xl px-2 py-1.5 text-center text-xs ${p.over ? "bg-terracota/10" : "bg-tinta/5 dark:bg-white/10"}`}>
              <span className={`block ${faint}`}>{p.label}</span>
              <span className={`block tnum font-medium ${p.over ? NEG : ""}`}>{formatEuros(p.cents)}</span>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

const DOT = { ok: "bg-petroleo dark:bg-teal-300", wait: "bg-tinta/20 dark:bg-creme/30", late: "bg-amber-500" } as const;

function Quiet({ to, tone, children }: { to: string; tone: keyof typeof DOT; children: ReactNode }) {
  return (
    <Link to={to} className={`flex items-center gap-2 text-xs ${faint} active:opacity-60`}>
      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${DOT[tone]}`} />
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}

/**
 * Two quiet lines, one for each of you, asking the same thing: is what you
 * bring in already in the account? Joana: what she received on Duet. João:
 * the salary and the despesas de representação.
 */
export function EmDia({
  month,
  joana,
  joanaLoading,
  joao,
  joaoName,
  joanaName,
}: {
  month: string;
  /** null: not from this month yet, or no Duet data. */
  joana: JoanaGap | null;
  joanaLoading: boolean;
  /** null: no salary set up in the plan. */
  joao: OwedStatus | null;
  joaoName: string;
  joanaName: string;
}) {
  if (!joao && !joana && !joanaLoading) return null;
  return (
    <div className="flex flex-col items-center gap-1.5">
      {joao && (
        <Quiet to={`/movimentos?mes=${month}&vista=entradas`} tone={joao.late > 0 ? "late" : joao.upcoming > 0 ? "wait" : "ok"}>
          {joaoName} ·{" "}
          {joao.late > 0 ? (
            <>
              faltam <Eur cents={joao.late} /> do ordenado e despesas
            </>
          ) : joao.upcoming > 0 ? (
            <>
              ordenado e despesas: <Eur cents={joao.upcoming} /> por entrar (dia {joao.nextDay})
            </>
          ) : (
            "ordenado e despesas já estão na conta"
          )}
        </Quiet>
      )}
      {(joana || joanaLoading) && (
        <Quiet to="/meses/joana" tone={joana == null ? "wait" : joana.missing > 0 ? "late" : "ok"}>
          {joanaName} ·{" "}
          {joana == null ? (
            "a ver a Duet…"
          ) : joana.missing > 0 ? (
            <>
              faltam <Eur cents={joana.missing} /> da Duet
            </>
          ) : (
            "tudo da Duet já está na conta"
          )}
        </Quiet>
      )}
    </div>
  );
}
