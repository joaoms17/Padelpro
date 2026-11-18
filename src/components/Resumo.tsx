// The first look of Este mês: the account's balance now and over the last
// months, what the two of you took, and (quietly) whether Joana's Duet money
// is all in the account.
import { Link } from "react-router-dom";
import { Bar, Eur } from "@/components/kit";
import { compactEuros, type JoanaGap } from "@/lib/meses";
import { VOCES_MARK, balanceChange, type BalancePoint, type VocesPoint } from "@/lib/resumo";
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

/** One quiet line: is everything Joana received on Duet in the account? */
export function JoanaLine({ gap, loading }: { gap: JoanaGap | null; loading: boolean }) {
  if (!gap && !loading) return null;
  const done = gap != null && gap.missing === 0;
  return (
    <Link to="/meses/joana" className={`flex items-center justify-center gap-2 text-xs ${faint} active:opacity-60`}>
      <span className={`w-1.5 h-1.5 rounded-full ${gap == null ? "bg-tinta/20 dark:bg-creme/30" : done ? "bg-petroleo dark:bg-teal-300" : "bg-amber-500"}`} />
      {gap == null ? (
        "Joana · a ver a Duet…"
      ) : done ? (
        "Joana · tudo da Duet já está na conta"
      ) : (
        <span>
          Joana · faltam <Eur cents={gap.missing} /> da Duet
        </span>
      )}
    </Link>
  );
}
