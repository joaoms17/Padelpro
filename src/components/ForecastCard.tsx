import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui";
import { formatCents, formatPct } from "@/lib/format";
import type { MetricsBundle } from "@/data/metrics";
import type { ForecastLine } from "@/lib/forecast";

const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function dayLabel(month: string, day: "first" | "last"): string {
  const [y, m] = month.split("-").map(Number);
  const d = day === "first" ? 1 : new Date(y, m, 0).getDate();
  return `${d} de ${MES_LONGO[m - 1]}`;
}

/**
 * The month as one balance, top to bottom: what the house account had on the
 * 1st, what came in and went out since, today's balance, what is still
 * coming in and going out, and where the month ends.
 */
export function ForecastCard({ m }: { m: MetricsBundle }) {
  const f = m.forecast;
  const today = f.balanceCents;
  const start = today - m.monthInCents + m.monthOutCents;
  const toCome = f.incoming.reduce((a, l) => a + l.cents, 0);
  const toGo = f.outgoing.reduce((a, l) => a + l.cents, 0);
  const end = f.endCents;
  // The month's result: everything in minus everything out, done and to come.
  const totalIn = m.monthInCents + toCome;
  const sobra = end - start;

  return (
    <Card className="bg-petroleo/5 border-petroleo/20">
      <div className="text-sm text-tinta/60 dark:text-creme/60">Previsão para {dayLabel(m.month, "last")}</div>
      <div className={`text-5xl font-display tnum ${end < 0 ? "text-terracota" : "text-petroleo"}`}>
        {formatCents(end)}
      </div>

      <div className="mt-4 space-y-1.5 text-sm tnum">
        <Row label={`Saldo a ${dayLabel(m.month, "first")}`} cents={start} muted />
        <Row label="Entrou este mês" cents={m.monthInCents} sign="+" />
        <Row label="Saiu este mês" cents={m.monthOutCents} sign="−" />
        <Total label="Saldo hoje" cents={today} />
        <Expandable label="Ainda vai entrar" cents={toCome} sign="+" lines={f.incoming} m={m} />
        <Expandable label="Ainda vai sair" cents={toGo} sign="−" lines={f.outgoing} m={m} />
        <Total label={`Previsão a ${dayLabel(m.month, "last")}`} cents={end} strong />
      </div>

      <p className="mt-3 text-xs text-tinta/50 dark:text-creme/50">
        O mês fecha com {sobra >= 0 ? "+" : ""}
        {formatCents(sobra)}
        {totalIn > 0 && ` · poupança ${formatPct(sobra / totalIn)}`}
        {" · "}
        <Link to="/entradas-previstas" className="text-petroleo">entradas previstas</Link>
        {" · "}
        <Link to="/conferir" className="text-petroleo">conferir</Link>
      </p>
      {m.incomes.length === 0 && (
        <p className="mt-1 text-xs text-terracota">
          Ainda não disseste o que costuma entrar —{" "}
          <Link to="/entradas-previstas" className="underline">adiciona o ordenado e o resto</Link>.
        </p>
      )}
    </Card>
  );
}

function Row({ label, cents, sign, muted }: { label: string; cents: number; sign?: "+" | "−"; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${muted ? "text-tinta/60 dark:text-creme/60" : ""}`}>
      <span>
        {sign && <span className="text-tinta/40 dark:text-creme/40">{sign} </span>}
        {label}
      </span>
      <span className={sign === "−" ? "text-terracota" : ""}>{sign === "−" ? `−${formatCents(cents)}` : formatCents(cents)}</span>
    </div>
  );
}

function Total({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-3 border-t border-areia/60 dark:border-white/10 pt-1.5 ${strong ? "font-semibold" : "font-medium"}`}
    >
      <span>= {label}</span>
      <span className={cents < 0 ? "text-terracota" : ""}>{formatCents(cents)}</span>
    </div>
  );
}

const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** A "still to come" row; tap to see what is behind it. */
function Expandable({
  label,
  cents,
  sign,
  lines,
  m,
}: {
  label: string;
  cents: number;
  sign: "+" | "−";
  lines: ForecastLine[];
  m: MetricsBundle;
}) {
  const [open, setOpen] = useState(false);
  const events = (m.duetMonthEvents ?? []).filter((e) => e.missing_cents > 0);
  return (
    <div>
      <button className="w-full flex justify-between gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <span className="text-tinta/40 dark:text-creme/40">{sign} </span>
          {label} <span className="text-tinta/40 dark:text-creme/40">{lines.length > 0 ? (open ? "▾" : "▸") : ""}</span>
        </span>
        <span className={sign === "−" ? "text-terracota" : ""}>{sign === "−" ? `−${formatCents(cents)}` : formatCents(cents)}</span>
      </button>
      {open && lines.length > 0 && (
        <ul className="pl-4 py-1 space-y-0.5 text-xs text-tinta/60 dark:text-creme/60">
          {lines.map((l) => (
            <li key={l.key}>
              <div className="flex justify-between gap-3">
                <span className="truncate">
                  {l.label}
                  {l.detail && <span className="text-tinta/40 dark:text-creme/40"> · {l.detail}</span>}
                </span>
                <span className="shrink-0">{formatCents(l.cents)}</span>
              </div>
              {l.key === "duet" &&
                events.map((e) => (
                  <div key={e.id} className="flex justify-between gap-3 pl-3 text-tinta/40 dark:text-creme/40">
                    <span className="truncate">{shortDate(e.date)} · {e.title}</span>
                    <span className="shrink-0">{formatCents(e.missing_cents)}</span>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
