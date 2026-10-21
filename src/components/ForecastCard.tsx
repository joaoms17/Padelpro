import { Link } from "react-router-dom";
import { Eur } from "@/components/kit";
import type { ForecastItem } from "@/lib/esteMes";
import { monthDay } from "@/lib/format";

/**
 * Where the house account ends the month: today's balance, plus what is still
 * to come in, minus what is still to go out.
 */
export function ForecastCard({
  month,
  balanceToday,
  toCome,
  toGo,
}: {
  month: string;
  balanceToday: number | null;
  toCome: ForecastItem[];
  toGo: ForecastItem[];
}) {
  const last = monthDay(month, "last");
  if (balanceToday == null) {
    return (
      <div className="card p-5 text-sm text-tinta/60 dark:text-creme/60">
        Sem saldo do banco ainda — a previsão para {last} aparece quando o banco for atualizado.{" "}
        <Link to="/ligar-banco" className="text-petroleo dark:text-teal-300 font-medium">Ligar o banco</Link>
      </div>
    );
  }
  const come = toCome.filter((l) => l.cents > 0);
  const go = toGo.filter((l) => l.cents > 0);
  const comeTotal = come.reduce((a, l) => a + l.cents, 0);
  const end = balanceToday + comeTotal - go.reduce((a, l) => a + l.cents, 0);

  return (
    <div className="card p-5">
      <div className="text-sm text-tinta/60 dark:text-creme/60">Previsão para {last}</div>
      <div className={`text-4xl font-display tnum ${end < 0 ? "text-terracota dark:text-orange-300" : "text-petroleo dark:text-teal-300"}`}>
        <Eur cents={end} />
      </div>

      <div className="mt-3 text-sm divide-y divide-areia/60 dark:divide-white/10">
        <Line label="Saldo hoje" cents={balanceToday} />
        <div className="py-1.5">
          <Line label="Ainda vai entrar" cents={comeTotal} sign="+" bare />
          {come.length === 0 ? (
            <p className="text-xs text-tinta/50 dark:text-creme/50">Já entrou tudo o que era esperado.</p>
          ) : (
            come.map((l) => <Line key={l.label} label={l.label} cents={l.cents} sub />)
          )}
        </div>
        {go.map((l) => (
          <Line key={l.label} label={l.label} cents={l.cents} sign="−" />
        ))}
        <div className="flex items-baseline justify-between gap-3 pt-2 font-semibold">
          <span className="min-w-0 truncate">= Previsão a {last}</span>
          <Eur cents={end} className={`shrink-0 ${end < 0 ? "text-terracota dark:text-orange-300" : ""}`} />
        </div>
      </div>
      {end < 0 && (
        <p className="mt-2 text-xs text-terracota dark:text-orange-300">A conta acaba o mês a negativo: vai ser preciso ir à poupança.</p>
      )}
    </div>
  );
}

function Line({ label, cents, sign, sub = false, bare = false }: { label: string; cents: number; sign?: "+" | "−"; sub?: boolean; bare?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${bare ? "" : sub ? "pl-4 text-xs text-tinta/60 dark:text-creme/60 py-0.5" : "py-1.5"}`}
    >
      <span className="min-w-0 truncate">
        {sign && <span className="text-tinta/40 dark:text-creme/40">{sign} </span>}
        {label}
      </span>
      <span className="shrink-0 tnum">
        {sign === "−" ? <Eur cents={-cents} /> : sign === "+" ? <Eur cents={cents} signed /> : <Eur cents={cents} />}
      </span>
    </div>
  );
}
