import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EngineData } from "@/data/engine";
import { lastDayOf, loadDuetEvents, loadDuetReceipts, type DuetReceiptsResult, type DuetResult } from "@/data/duet";
import { useJoanaWaivers } from "@/data/incomes";
import { addMonth } from "@/lib/forecast";
import { JOANA_FROM } from "@/lib/month";
import type { JoanaGap } from "@/lib/meses";
import { monthName, monthTitle } from "@/lib/format";
import {
  bookedMonths,
  byProject,
  joanaMonthRows,
  joanaNow,
  joanaStats,
  joanaTransfers,
  joanaUnclassified,
  pct,
  rangeLabel,
  type Receipt,
} from "@/lib/joanaView";
import type { MonthsView } from "@/lib/view";
import { Bar, Eur, Section } from "./kit";

const muted = "text-tinta/60 dark:text-creme/60";
const faint = "text-tinta/50 dark:text-creme/50";
const POS = "text-petroleo dark:text-teal-300";
const NEG = "text-terracota dark:text-orange-300";
const LINK = "font-medium text-petroleo dark:text-teal-300 active:opacity-60";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "2026-09-12" → "12/09". */
const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const joanaCents = (view: MonthsView, m: string) => view.real.get(m)?.entradas.find((l) => l.key === "joana")?.cents ?? 0;

/** Joana's months on Duet: averages for the plan, month by month, per project, what is booked and what reached the account. */
export function JoanaHistory({ data, view }: { data: EngineData; view: MonthsView }) {
  const current = view.current;
  const today = data.ctx.today;
  // One call each: the last 12 complete months and this one, and this month plus the next 6.
  const from = `${addMonth(current, -12)}-01`;
  const [receipts, setReceipts] = useState<DuetReceiptsResult | null>(null);
  const [events, setEvents] = useState<DuetResult | null>(null);
  useEffect(() => {
    let alive = true;
    setReceipts(null);
    void loadDuetReceipts(from, today).then((r) => alive && setReceipts(r));
    return () => {
      alive = false;
    };
  }, [from, today]);
  useEffect(() => {
    let alive = true;
    setEvents(null);
    void loadDuetEvents(`${current}-01`, lastDayOf(addMonth(current, 6))).then((r) => alive && setEvents(r));
    return () => {
      alive = false;
    };
  }, [current]);
  const { waivers } = useJoanaWaivers(data.householdId);

  // What reached the account: the months with whole bank data.
  const bank = useMemo(() => Object.fromEntries(view.closed.map((m) => [m, joanaCents(view, m)])), [view]);
  const transfers = useMemo(() => {
    const months = view.months.filter((m) => m >= addMonth(current, -12));
    return joanaTransfers(months.map((m) => view.real.get(m)!), data.txs);
  }, [view, current, data.txs]);
  const odd = useMemo(() => joanaUnclassified(data.txs, data.ctx, from), [data, from]);

  const list = useMemo<Receipt[]>(() => (receipts?.configured && !receipts.error ? receipts.receipts : []), [receipts]);
  const eventList = useMemo(() => (events?.configured && !events.error ? events.events : null), [events]);
  const stats = useMemo(() => joanaStats(list, current), [list, current]);
  const rows = useMemo(() => joanaMonthRows(list, current, bank, waivers ?? {}), [list, current, bank, waivers]);
  const projects = useMemo(() => byProject(list, stats.months), [list, stats.months]);
  const now = useMemo(
    () => joanaNow(list, eventList ?? [], current, joanaCents(view, current), waivers?.[current] ?? 0),
    [list, eventList, current, view, waivers],
  );
  const booked = useMemo(() => (eventList ? bookedMonths(eventList, current) : []), [eventList, current]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-display">Joana · Duet</h2>
        <p className={`text-sm ${muted}`}>A Joana põe na conta tudo o que recebe na Duet (a partir de novembro).</p>
      </div>

      {!receipts ? (
        <p className={`text-sm ${faint}`}>A ver a Duet…</p>
      ) : receipts.error ? (
        <p className={`text-sm ${NEG}`}>Não consegui ver a Duet: {receipts.error}</p>
      ) : !receipts.configured ? (
        <p className={`card p-4 text-sm ${muted}`}>A ligação à Duet não está configurada.</p>
      ) : (
        <>
          <Summary stats={stats} />

          {rows.length > 0 && (
            <Section title="Mês a mês">
              <div className="card px-4 py-1 divide-y divide-areia/60 dark:divide-white/5">
                {rows.map((r) => (
                  <Expandable
                    key={r.month}
                    head={
                      <>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">
                            {monthTitle(r.month)}
                            {stats.months.length > 1 && stats.best?.month === r.month && <span className={`text-xs font-normal ${POS}`}> · melhor</span>}
                            {stats.months.length > 1 && stats.weakest?.month === r.month && <span className={`text-xs font-normal ${faint}`}> · mais fraco</span>}
                          </span>
                          <Eur cents={r.cents} className="shrink-0 font-medium" />
                        </div>
                        <div className="mt-1.5">
                          <Bar value={r.cents} max={stats.best?.cents ?? 0} />
                        </div>
                      </>
                    }
                    sub={
                      <>
                        {plural(r.count, "pagamento", "pagamentos")}
                        {r.bank != null && (
                          <>
                            {" · chegou à conta "}
                            <Eur cents={r.bank} />
                            <GapNote gap={waivers ? r.gap : null} duet={r.cents} />
                          </>
                        )}
                      </>
                    }
                    open={r.count > 0}
                  >
                    <ReceiptList receipts={r.receipts} month={r.month} bankMonth={view.months.includes(r.month)} />
                  </Expandable>
                ))}
              </div>
              {rows.some((r) => r.bank != null && r.month < JOANA_FROM) && (
                <p className={`mt-2 px-1 text-xs ${faint}`}>Antes de novembro a Joana ainda não passava tudo para a conta — não é dívida.</p>
              )}
            </Section>
          )}

          <Section title={`${cap(monthName(current))} até hoje`}>
            <div className="card px-4 py-1">
              <Expandable
                head={
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">Recebido na Duet até hoje</span>
                    <Eur cents={now.cents} className="shrink-0 font-medium" />
                  </div>
                }
                sub={
                  <>
                    {plural(now.count, "pagamento", "pagamentos")}
                    {now.bank != null && (
                      <>
                        {" · chegou à conta "}
                        <Eur cents={now.bank} />
                        <GapNote gap={waivers ? now.gap : null} duet={now.cents} />
                      </>
                    )}
                  </>
                }
                open={now.count > 0}
              >
                <ReceiptList receipts={now.receipts} month={current} bankMonth={view.months.includes(current)} />
              </Expandable>
              <div className="border-t border-areia/60 dark:border-white/5 py-2.5 text-sm">
                {!events ? (
                  <p className={faint}>A ver os eventos…</p>
                ) : events.error ? (
                  <p className={NEG}>Não consegui ver os eventos: {events.error}</p>
                ) : (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      Ainda por receber na Duet
                      <span className={`block text-xs ${faint}`}>
                        {now.pending > 0 ? plural(now.pending, "evento deste mês", "eventos deste mês") : "Nada por receber dos eventos deste mês"}
                      </span>
                    </span>
                    <Eur cents={now.toReceive} className="shrink-0 font-medium" />
                  </div>
                )}
              </div>
            </div>
          </Section>

          {booked.length > 0 && <Booked booked={booked} average={stats.average} />}

          {projects.length > 0 && (
            <Section title="Por projeto">
              <div className="card px-4 py-3 space-y-3">
                {projects.map((p) => (
                  <div key={p.project}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        {p.project} <span className={`text-xs ${faint}`}>· {plural(p.count, "pagamento", "pagamentos")}</span>
                      </span>
                      <span className="shrink-0">
                        <Eur cents={p.cents} className="font-medium" /> <span className={`text-xs ${faint}`}>{pct(p.share)}</span>
                      </span>
                    </div>
                    <div className="mt-1">
                      <Bar value={p.share} max={1} />
                    </div>
                  </div>
                ))}
                <p className={`text-xs ${faint}`}>Nos meses completos, {rangeLabel(stats.months)}.</p>
              </div>
            </Section>
          )}
        </>
      )}

      <Section title="Transferências para a conta">
        {odd.length > 0 && (
          <div className="mb-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 space-y-1">
            <p className="font-medium">
              {odd.length === 1 ? "Há 1 entrada" : `Há ${odd.length} entradas`} com o nome da Joana que não {odd.length === 1 ? "conta" : "contam"} como dela:
            </p>
            {odd.map((t) => (
              <Link key={t.id} to={`/movimentos?mes=${t.booking_date.slice(0, 7)}&vista=entradas`} className="flex items-baseline justify-between gap-3 text-xs active:opacity-60">
                <span className="min-w-0 truncate">
                  {dayMonth(t.booking_date)} · {t.description_raw}
                </span>
                <Eur cents={t.amount_cents} className="shrink-0" />
              </Link>
            ))}
            <p className="text-xs">Se for dela, muda a categoria em Movimentos.</p>
          </div>
        )}
        {transfers.length === 0 ? (
          <p className={`card p-4 text-sm ${muted}`}>Ainda não há movimentos do banco.</p>
        ) : (
          <div className="card px-4 py-1 divide-y divide-areia/60 dark:divide-white/5">
            {transfers.map((m) => (
              <div key={m.month} className="py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">
                    {monthTitle(m.month)}
                    {m.month === current && <span className={`text-xs font-normal ${faint}`}> · até hoje</span>}
                  </span>
                  <Eur cents={m.cents} className="shrink-0 font-medium" />
                </div>
                {m.transfers.length === 0 ? (
                  <p className={`text-xs ${faint}`}>Nenhuma transferência.</p>
                ) : (
                  <>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {m.transfers.map((t) => (
                        <li key={t.id} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate">
                            <span className={`tnum ${faint}`}>{dayMonth(t.date)}</span> · {t.title}
                          </span>
                          <Eur cents={t.cents} className="shrink-0" />
                        </li>
                      ))}
                    </ul>
                    <Link to={`/movimentos?mes=${m.month}&vista=entradas&linha=joana`} className={`mt-1 inline-block text-xs ${LINK}`}>
                      Ver em Movimentos →
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Summary({ stats }: { stats: ReturnType<typeof joanaStats> }) {
  const n = stats.months.length;
  if (stats.average == null) {
    return <p className={`card p-4 text-sm ${muted}`}>Nada recebido na Duet nos últimos 12 meses completos.</p>;
  }
  return (
    <div className="card p-4 space-y-3">
      <div>
        <p className={`text-xs ${faint}`}>Média · {plural(n, "mês completo", "meses completos")}</p>
        <p className="font-display text-3xl">
          <Eur cents={stats.average} />
          <span className={`text-base ${muted}`}>/mês</span>
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        <Fig label="Mediana" value={<Eur cents={stats.median ?? 0} />} />
        <Fig label={`Total dos ${plural(n, "mês", "meses")}`} value={<Eur cents={stats.total} />} />
        {n > 1 && stats.best && <Fig label="Melhor mês" value={<Eur cents={stats.best.cents} />} sub={monthName(stats.best.month)} />}
        {n > 1 && stats.weakest && <Fig label="Mais fraco" value={<Eur cents={stats.weakest.cents} />} sub={monthName(stats.weakest.month)} />}
      </dl>
      <p className={`text-xs ${faint}`}>
        {cap(rangeLabel(stats.months))}. É a média com que o{" "}
        <Link to="/plano#joana" className={LINK}>
          Plano
        </Link>{" "}
        conta.
      </p>
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className={`text-xs ${faint}`}>{label}</dt>
      <dd className="font-medium">
        {value}
        {sub && <span className={`text-xs font-normal ${muted}`}> · {sub}</span>}
      </dd>
    </div>
  );
}

/** "· faltam 300 €" / "· o resto não é dívida" / "✓" — only from November (gap set). */
function GapNote({ gap, duet }: { gap: JoanaGap | null; duet: number }) {
  if (!gap) return null;
  if (gap.missing > 0) {
    return (
      <span className={NEG}>
        {" · faltam "}
        <Eur cents={gap.missing} />
      </span>
    );
  }
  if (gap.waived > 0) return <span> · o resto não é dívida</span>;
  return duet > 0 ? <span className={POS}> ✓</span> : null;
}

/** A row that opens to its details (tap anywhere on it). */
function Expandable({ head, sub, open: canOpen, children }: { head: ReactNode; sub: ReactNode; open: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-2.5">
      <button
        className="block w-full text-left active:opacity-60 disabled:active:opacity-100"
        onClick={() => setOpen((o) => !o)}
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
      >
        {head}
        <p className={`mt-1 text-xs ${faint}`}>
          {sub}
          {canOpen && <span> {open ? "▾" : "▸"}</span>}
        </p>
      </button>
      {canOpen && open && children}
    </div>
  );
}

function ReceiptList({ receipts, month, bankMonth }: { receipts: Receipt[]; month: string; bankMonth: boolean }) {
  return (
    <div className="mt-2 rounded-xl bg-areia/30 dark:bg-white/5 px-3 py-2 text-xs space-y-1">
      <ul className="space-y-1">
        {receipts.map((x, i) => (
          <li key={`${x.date}-${i}`} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              <span className={`tnum ${faint}`}>{dayMonth(x.date)}</span> · {x.title}
              {x.project && <span className={faint}> · {x.project}</span>}
            </span>
            <Eur cents={x.amount_cents} className="shrink-0" />
          </li>
        ))}
      </ul>
      {bankMonth && (
        <Link to={`/meses/${month}`} className={`inline-block pt-0.5 ${LINK}`}>
          Ver {monthName(month)} em Meses →
        </Link>
      )}
    </div>
  );
}

function Booked({ booked, average }: { booked: ReturnType<typeof bookedMonths>; average: number | null }) {
  const max = Math.max(average ?? 0, ...booked.map((b) => b.cents));
  return (
    <Section title="Próximos meses">
      <div className="card px-4 py-3 space-y-3">
        <p className={`text-xs ${faint}`}>Já marcado na Duet (o valor dos eventos).</p>
        {booked.map((b) => (
          <div key={b.month}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {cap(monthName(b.month))}
                <span className={`text-xs ${faint}`}> · {b.count === 0 ? "nada marcado" : plural(b.count, "evento", "eventos")}</span>
              </span>
              <Eur cents={b.cents} className="shrink-0 font-medium" />
            </div>
            <div className="mt-1">
              <Bar value={b.cents} max={max} tick={average != null && max > 0 ? average / max : undefined} />
            </div>
          </div>
        ))}
        {average != null && (
          <p className={`text-xs ${faint}`}>
            A marca é a média dela (<Eur cents={average} />
            /mês). Ainda podem entrar mais eventos.
          </p>
        )}
      </div>
    </Section>
  );
}
