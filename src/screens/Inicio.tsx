import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useHousehold } from "@/data/household";
import { useEngineData, type EngineData } from "@/data/engine";
import { useDuetMonth, type DuetMonth } from "@/data/duet";
import { useJoanaWaivers } from "@/data/incomes";
import { buildMonthsView, type MonthsView } from "@/lib/view";
import { modelMonth, monthControl, planTotals, type CategoryControl, type MonthControl } from "@/lib/plan";
import { JOANA_FROM, type MonthBreakdown } from "@/lib/month";
import { mesadaFor } from "@/lib/mesadas";
import { joanaGap, type JoanaGap } from "@/lib/meses";
import { daysInMonth } from "@/lib/budget";
import {
  applePayPending,
  bankNotes,
  bankPending,
  comArtigo,
  forecastParts,
  incomeProgress,
  mesadaRows,
  monthsLabel,
  prepSteps,
  reviewCount,
  semSaiuBySource,
  type IncomeProgress,
  type MesadaRow,
  type ReviewCount,
  type StatusNote,
} from "@/lib/esteMes";
import { formatEuros, monthDay, monthName, monthTitle } from "@/lib/format";
import { Bar, Eur, Loading, Pill, Ring, Section } from "@/components/kit";
import { catIcon } from "@/lib/catIcon";
import { EmDia, SaldoCard, VocesCard } from "@/components/Resumo";
import { balanceSeries, salaryStatus, vocesSeries } from "@/lib/resumo";
import { ForecastCard } from "@/components/ForecastCard";

const muted = "text-tinta/60 dark:text-creme/60";
const faint = "text-tinta/50 dark:text-creme/50";
const POS = "text-petroleo dark:text-petroleo";
const NEG = "text-terracota dark:text-terracota";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Este mês: preparing the plan until December, then controlling the month. */
export function Inicio() {
  const { householdId } = useHousehold();
  const { data, error } = useEngineData(householdId);
  const view = useMemo(() => (data ? buildMonthsView(data) : null), [data]);
  if (!data || !view) {
    return (
      <div className="space-y-6">
        <Header />
        <Loading error={error} />
      </div>
    );
  }
  return <EsteMes data={data} view={view} error={error} />;
}

function EsteMes({ data, view, error }: { data: EngineData; view: MonthsView; error: string | null }) {
  const month = view.current;
  const real = view.real.get(month)!;
  const sem = view.semPontuais.get(month)!;
  // The limits are the plan's: one-offs ("pontual") stay out of them.
  const control = monthControl(sem, data.allCategories, data.plan, data.ctx.today);
  const controlar = control.diaLimit > 0;
  const lastClosed = view.lastClosed ? (view.real.get(view.lastClosed) ?? null) : null;
  // Joana puts in everything she receives on Duet: what she got this month.
  const duet = useDuetMonth(month);
  const { waivers } = useJoanaWaivers(data.householdId);
  // The same question for each: is what you bring in already in the account?
  const mine = incomeProgress(data.incomes, real).groups.filter((g) => g.kind === "salario" || g.kind === "representacao");
  const salary = mine.length > 0 ? salaryStatus(mine, Number(data.ctx.today.slice(8, 10))) : null;
  const isJoana = (n: string) => n.trim().toLowerCase() === "joana";
  const joanaName = data.members.find((m) => isJoana(m.display_name))?.display_name ?? "Joana";
  const joaoName = data.members.find((m) => !isJoana(m.display_name))?.display_name ?? "João";
  const saldo = balanceSeries(view.months, view.endBalance, month);
  const prev = saldo.length > 1 ? saldo[saldo.length - 2] : null;
  const joanaNow = duet?.configured
    ? joanaGap(duet.cents, real.entradas.find((l) => l.key === "joana")?.cents ?? 0, waivers?.[month] ?? 0)
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Header month={month} />
        <StatusLine notes={bankNotes(data.lastSyncAt, data.consentUntil, Date.now())} review={reviewCount(data.txs, month)} />
      </div>
      {error && <p className="text-sm text-terracota dark:text-terracota">Não consegui atualizar: {error}</p>}
      <SaldoCard balance={data.balanceCents} series={saldo} prevLabel={prev ? monthName(prev.month) : null} />
      <div className="space-y-3">
        <VocesCard series={vocesSeries(view.months, (m) => view.real.get(m)?.voces ?? 0, month)} month={month} />
        <EmDia
          month={month}
          joana={month >= JOANA_FROM ? joanaNow : null}
          joanaLoading={month >= JOANA_FROM && duet === null}
          joao={salary}
          joaoName={joaoName}
          joanaName={joanaName}
        />
      </div>
      {controlar ? (
        <Controlar data={data} real={real} sem={sem} control={control} lastClosed={lastClosed} duet={duet} waived={waivers?.[month] ?? 0} />
      ) : (
        <Preparar data={data} view={view} real={real} sem={sem} control={control} lastClosed={lastClosed} duet={duet} />
      )}
    </div>
  );
}

function Header({ month }: { month?: string }) {
  return (
    <header className="pr-12 space-y-0.5">
      <h1 className="text-3xl font-display">Este mês</h1>
      {month && <p className={muted}>{monthTitle(month)}</p>}
    </header>
  );
}

const TONE: Record<StatusNote["tone"], string> = {
  grey: faint,
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-terracota dark:text-terracota",
};

function StatusLine({ notes, review }: { notes: StatusNote[]; review: ReviewCount }) {
  const parts = [review.sem > 0 && `${review.sem} sem categoria`, review.validar > 0 && `${review.validar} por confirmar`].filter(Boolean);
  return (
    <div className="space-y-2 text-sm">
      {notes.map((n) => (
        <p key={n.text} className={TONE[n.tone]}>
          {n.text}
          {n.action && (
            <>
              {" — "}
              <Link to={n.action.to} className="font-medium underline underline-offset-2">
                {n.action.label}
              </Link>
            </>
          )}
        </p>
      ))}
      {parts.length > 0 && (
        <Link
          to={review.to}
          className="inline-block rounded-full border border-terracota/40 bg-terracota/5 px-3 py-1 text-xs font-medium text-terracota dark:text-terracota active:opacity-60"
        >
          {parts.join(" · ")} →
        </Link>
      )}
    </div>
  );
}

/** "Setembro fechou: sobraram 1 234 €  Ver →" */
function ClosedLink({ b }: { b: MonthBreakdown }) {
  const s = b.sobrou;
  return (
    <Link to={`/meses/${b.month}`} className="card p-4 flex items-center justify-between gap-3 active:opacity-60">
      <span className="min-w-0">
        {cap(monthName(b.month))} fechou: {s >= 0 ? "sobraram" : "faltaram"}{" "}
        <Eur cents={Math.abs(s)} className={`font-semibold ${s >= 0 ? POS : NEG}`} />
        {b.status === "provisorio" && <span className={`text-xs ${faint}`}> · provisório</span>}
      </span>
      <span className="shrink-0 text-sm font-medium text-petroleo dark:text-petroleo">Ver →</span>
    </Link>
  );
}

// ── Preparar: until there are limits for the dia a dia ──────────────────────

function Preparar({
  data,
  view,
  real,
  sem,
  control,
  lastClosed,
  duet,
}: {
  data: EngineData;
  view: MonthsView;
  real: MonthBreakdown;
  sem: MonthBreakdown;
  control: MonthControl;
  lastClosed: MonthBreakdown | null;
  duet: DuetMonth | null;
}) {
  const plan = data.plan;
  const month = real.month;
  const totals = planTotals(data.incomes, data.allCategories, plan, data.members.map((m) => m.id));
  const steps = prepSteps({
    closed: view.closed.map((m) => view.real.get(m)!),
    txs: data.txs,
    incomes: data.incomes,
    plan,
    categories: data.allCategories,
    totals,
    members: data.members,
  });
  const done = steps.filter((s) => s.done).length;
  // With the model Joana puts in everything she received on Duet.
  const model = modelMonth(sem, data.incomes, plan, data.members, duet?.configured ? duet.cents : null);
  const hasMesadas = Object.keys(plan.mesadas).length > 0;
  const top = real.categorias.filter((c) => c.area === "dia" && c.cents > 0).slice(0, 5);
  const avg = view.averages;
  const tick = control.day / daysInMonth(month);
  const people = real.pessoas.filter((p) => p.memberId);

  return (
    <>
      <section className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-display min-w-0">
            {month < plan.start_month ? `Para decidir até ${monthDay(plan.start_month, "first")}` : "Para o plano funcionar"}
          </h2>
          <span className={`shrink-0 text-sm tnum ${muted}`}>
            {done} de {steps.length}
          </span>
        </div>
        <ul className="mt-2 divide-y divide-areia/60 dark:divide-white/10">
          {steps.map((s) => (
            <li key={s.key}>
              <Link to={s.to} className="flex items-center gap-3 py-2.5 active:opacity-60">
                <span
                  aria-label={s.done ? "feito" : "por fazer"}
                  className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                    s.done ? "bg-petroleo text-creme dark:text-tinta" : "border-2 border-tinta/20 dark:border-creme/25"
                  }`}
                >
                  {s.done ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${s.done ? muted : "font-medium"}`}>{s.label}</span>
                  <span className={`block truncate text-xs ${s.done ? faint : s.key === "categorizar" ? "text-terracota dark:text-terracota" : faint}`}>{s.sub}</span>
                </span>
                <span className={`shrink-0 ${faint}`}>›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Section title={`${cap(monthName(month))} até hoje`}>
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Entrou" cents={real.entrou} />
            <Figure label="Casa" cents={real.casa} />
            <Figure label="Para vocês" cents={real.voces} />
          </div>
          {real.semSaiu > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              E mais <Eur cents={real.semSaiu} /> que ainda não têm categoria.
            </p>
          )}
          {duet?.configured && (
            <Link to="/meses/joana" className="block text-sm active:opacity-60">
              Joana: <Eur cents={duet.cents} className="font-medium" /> recebidos na Duet
              <span className={faint}> ({duet.count} {duet.count === 1 ? "pagamento" : "pagamentos"})</span> ·{" "}
              <Eur cents={real.entradas.find((l) => l.key === "joana")?.cents ?? 0} className="font-medium" /> já na conta
              <span className={POS}> →</span>
              {month < JOANA_FROM && <span className={`block text-xs ${faint}`}>A partir de novembro tudo o que recebe na Duet passa para a conta.</span>}
            </Link>
          )}
          {top.length > 0 && (
            <div>
              <p className={`text-xs mb-1 ${faint}`}>
                Dia a dia — o que mais pesa{avg.months.length > 0 && ` · média de ${monthsLabel(avg.months)}`}
              </p>
              <div className="space-y-2">
                {top.map((c) => {
                  const mean = avg.categorias.get(c.categoryId)?.mean ?? 0;
                  return (
                    <div key={c.categoryId}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">{c.name}</span>
                        <span className="shrink-0 tnum">
                          <Eur cents={c.cents} />
                          {mean > 0 && (
                            <span className={faint}>
                              {" · média "}
                              <Eur cents={mean} />
                            </span>
                          )}
                        </span>
                      </div>
                      {mean > 0 && <Bar value={c.cents} max={mean} tick={tick} level={c.cents > mean ? "warn" : "ok"} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <Link to={`/meses/${month}`} className="block text-sm font-medium text-petroleo dark:text-petroleo">
            Ver o mês em detalhe →
          </Link>
        </div>
      </Section>

      <Section title="Se o modelo já estivesse em vigor">
        <div className="card p-5 space-y-2 text-sm">
          {hasMesadas ? (
            <p>
              Mesadas:{" "}
              {model.pessoas.map((p, i) => (
                <span key={p.memberId}>
                  {i > 0 && " + "}
                  {p.name} <Eur cents={p.modelo} />
                </span>
              ))}
              . Com os gastos até hoje, este mês {model.sobra >= 0 ? "sobravam" : "faltavam"}{" "}
              <Eur cents={Math.abs(model.sobra)} className={`font-semibold ${model.sobra >= 0 ? POS : NEG}`} />.
            </p>
          ) : (
            <p>
              Ainda não há mesadas no plano.{" "}
              <Link to="/plano#mesadas" className="font-medium text-petroleo dark:text-petroleo">
                Define-as no Plano →
              </Link>
            </p>
          )}
          {people.length > 0 && (
            <p className={muted}>
              Até agora:{" "}
              {people.map((p, i) => (
                <span key={p.memberId}>
                  {i > 0 && ", "}
                  {comArtigo(p.name)}
                  {i === 0 && " passou para si"} <Eur cents={p.net} />
                </span>
              ))}
              .
            </p>
          )}
        </div>
      </Section>

      {lastClosed && <ClosedLink b={lastClosed} />}
    </>
  );
}

function Figure({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="min-w-0">
      <div className={`text-xs ${faint}`}>{label}</div>
      <div className="text-lg font-display tnum truncate">
        <Eur cents={cents} />
      </div>
    </div>
  );
}

// ── Controlar: the month against the limits ────────────────────────────────

const LEVEL_TEXT = { ok: POS, warn: "text-amber-700 dark:text-amber-300", over: NEG } as const;
const LEVEL_RANK = { over: 0, warn: 1, ok: 2 } as const;

function Controlar({
  data,
  real,
  sem,
  control,
  lastClosed,
  duet,
  waived,
}: {
  data: EngineData;
  real: MonthBreakdown;
  sem: MonthBreakdown;
  control: MonthControl;
  lastClosed: MonthBreakdown | null;
  duet: DuetMonth | null;
  /** The part of Joana's difference this month marked as not owed. */
  waived: number;
}) {
  const plan = data.plan;
  const month = control.month;
  const dim = daysInMonth(month);
  const tick = control.day / dim;
  const ensaio = month < plan.start_month;
  const mesadaOf = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? mesadaFor(m, month, data.mesadaMonths) : 0;
  };
  const incomes = incomeProgress(data.incomes, real);
  const joanaArrived = real.entradas.find((l) => l.key === "joana")?.cents ?? 0;
  // From November all she received on Duet is to reach the account.
  const joanaDuet = month >= JOANA_FROM && duet?.configured ? duet.cents : null;
  const joana = joanaDuet != null ? joanaGap(joanaDuet, joanaArrived, waived) : null;
  const mesadas = mesadaRows(data.members, sem, real, mesadaOf);
  const forecast = forecastParts({
    control,
    incomes,
    joana: joanaDuet != null ? { duet: joanaDuet, arrived: joanaArrived, waived } : null,
    mesadas,
    applePay: applePayPending(data.txs, month, data.ctx.today),
    pending: bankPending(data.txs, month),
  });
  // Uncategorized Apple Pay notes are not in Movimentos' "Por categorizar".
  const semSaiu = semSaiuBySource(sem, data.txs);
  const pontualDia = Math.max(0, real.dia - sem.dia);
  const over = control.diaLeft < 0;
  const paceOver = !over && control.day >= 7 && control.day < dim && control.diaProjected > control.diaLimit;
  const level = over ? "over" : paceOver ? "warn" : "ok";
  const icons = new Map(data.allCategories.map((c) => [c.id, catIcon(c.name, c.icon)]));

  return (
    <>
      <section className="card p-5">
        {ensaio && (
          <div className="mb-3 text-center">
            <Pill tone="amber">A experimentar — o plano começa em {monthName(plan.start_month)}</Pill>
          </div>
        )}
        <div className="flex flex-col items-center text-center">
          <Ring value={control.diaSpent} max={control.diaLimit} tick={tick} level={level}>
            <span className={`text-xs ${muted}`}>{over ? "Acima do limite" : "Podem gastar"}</span>
            <span className={`text-4xl font-display tnum leading-tight ${LEVEL_TEXT[over ? "over" : "ok"]}`}>
              <Eur cents={Math.abs(control.diaLeft)} />
            </span>
            <span className={`text-xs ${faint}`}>
              {over ? "no dia a dia" : control.daysLeft > 1 ? `${formatEuros(control.perDay)} por dia` : "é o último dia"}
            </span>
          </Ring>
          <p className={`mt-3 text-lg font-display ${LEVEL_TEXT[level]}`}>
            {over ? "Passaram o limite do dia a dia" : paceOver ? "A gastar depressa demais" : "No bom caminho"}
          </p>
          {paceOver && (
            <p className={`text-sm ${muted}`}>
              A este ritmo o mês acaba em <Eur cents={control.diaProjected} />.
            </p>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-areia/70 dark:divide-white/10 text-center">
          <Figure label="Já gastaram" cents={control.diaSpent} />
          <Figure label="Limite" cents={control.diaLimit} />
          <div className="min-w-0">
            <div className={`text-xs ${faint}`}>Faltam</div>
            <div className="text-lg font-display tnum truncate">
              {control.daysLeft} {control.daysLeft === 1 ? "dia" : "dias"}
            </div>
          </div>
        </div>
        {(semSaiu.banco > 0 || semSaiu.applePay > 0) && (
          <Link
            to={semSaiu.banco > 0 ? `/movimentos?mes=${month}&vista=categorizar` : `/movimentos?mes=${month}&vista=todos`}
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200 active:opacity-60"
          >
            <span className="min-w-0">
              <Eur cents={semSaiu.banco + semSaiu.applePay} className="font-semibold" /> sem categoria ainda não contam
            </span>
            <span className="shrink-0 font-medium">Tratar →</span>
          </Link>
        )}
        {pontualDia > 0 && (
          <p className={`mt-2 text-center text-xs ${faint}`}>
            Os gastos pontuais (<Eur cents={pontualDia} />) ficam fora do limite.
          </p>
        )}
      </section>

      <DiaADia control={control} tick={tick} month={month} covers={plan.mesada_covers} icons={icons} />

      <Fixas control={control} />

      <Mesadas rows={mesadas} />

      <Entradas
        month={month}
        incomes={incomes}
        joanaDuet={joanaDuet}
        joana={joana}
        joanaArrived={joanaArrived}
        duetLoading={duet === null}
        total={real.entrou}
      />

      <ForecastCard month={month} balanceToday={data.balanceCents} toCome={forecast.toCome} toGo={forecast.toGo} />

      {control.day <= 5 && lastClosed && <ClosedLink b={lastClosed} />}
    </>
  );
}

/** One category against its limit: picture, name, how much, a bar. */
function CatTile({ c, tick, month, icon }: { c: CategoryControl; tick: number; month: string; icon: string }) {
  const left = (c.budget ?? 0) - c.spent;
  const edge = c.level === "over" ? "border-terracota/40 bg-terracota/5" : c.level === "warn" ? "border-amber-500/40 bg-amber-500/5" : "";
  return (
    <Link to={`/movimentos?mes=${month}&cat=${c.categoryId}`} className={`card p-3.5 block active:opacity-60 ${edge}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-9 h-9 rounded-full bg-areia/60 dark:bg-white/10 flex items-center justify-center text-lg" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 text-sm font-medium leading-tight line-clamp-2">{c.name}</span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <span className="text-xl font-display tnum">
          <Eur cents={c.spent} />
        </span>
        <span className={`text-xs tnum ${faint}`}>
          de <Eur cents={c.budget ?? 0} />
        </span>
      </div>
      <div className="mt-1.5">
        <Bar value={c.spent} max={c.budget ?? 0} tick={tick} level={c.level} />
      </div>
      <div className={`mt-1.5 text-xs ${c.level === "ok" ? faint : LEVEL_TEXT[c.level]}`}>
        {left < 0 ? (
          <>
            <Eur cents={-left} /> a mais
          </>
        ) : (
          <>
            sobram <Eur cents={left} />
          </>
        )}
      </div>
    </Link>
  );
}

function DiaADia({
  control,
  tick,
  month,
  covers,
  icons,
}: {
  control: MonthControl;
  tick: number;
  month: string;
  covers: string[];
  icons: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const cats = control.categorias.filter((c) => c.grp === "variavel" || c.grp === "atividade");
  const pct = (c: CategoryControl) => c.spent / (c.budget || 1);
  const limited = cats.filter((c) => (c.budget ?? 0) > 0).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || pct(b) - pct(a));
  const free = cats.filter((c) => !((c.budget ?? 0) > 0) && c.spent !== 0);
  const freeTotal = free.reduce((a, c) => a + c.spent, 0);
  const trouble = limited.filter((c) => c.level !== "ok").length;
  // Those needing attention always show; the rest up to six.
  const FIRST = Math.max(6, trouble + (trouble % 2));
  const [all, setAll] = useState(false);
  const shown = all ? limited : limited.slice(0, FIRST);
  if (limited.length === 0 && free.length === 0) return null;
  return (
    <Section
      title="Onde está a ir"
      right={
        trouble > 0 ? (
          <span className={`text-xs ${NEG}`}>
            {trouble} a precisar de atenção
          </span>
        ) : (
          <span className={`text-xs ${POS}`}>tudo dentro dos limites</span>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {shown.map((c) => (
          <CatTile key={c.categoryId} c={c} tick={tick} month={month} icon={icons.get(c.categoryId) ?? "•"} />
        ))}
      </div>
      {limited.length > FIRST && (
        <button onClick={() => setAll((a) => !a)} aria-expanded={all} className="mt-3 w-full card px-4 py-3 text-sm font-medium text-petroleo dark:text-petroleo active:opacity-60">
          {all ? "Mostrar menos" : `Ver as outras ${limited.length - FIRST} categorias`}
        </button>
      )}
      {free.length > 0 && (
        <div className="mt-3 card px-4 py-3">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 text-sm active:opacity-60">
            <span className={muted}>
              +{free.length} sem limite {open ? "▾" : "▸"}
            </span>
            <Eur cents={freeTotal} className="font-medium" />
          </button>
          {open && (
            <ul className="mt-2 space-y-1 text-sm">
              {free.map((c) => (
                <li key={c.categoryId}>
                  <Link to={`/movimentos?mes=${month}&cat=${c.categoryId}`} className="flex justify-between gap-3 py-0.5 active:opacity-60">
                    <span className={`min-w-0 truncate ${muted}`}>
                      {icons.get(c.categoryId)} {c.name}
                      {covers.includes(c.categoryId) && " · paga a mesada"}
                    </span>
                    <Eur cents={c.spent} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function Fixas({ control }: { control: MonthControl }) {
  const fixas = control.categorias.filter((c) => c.grp === "fixa");
  const spent = fixas.reduce((a, c) => a + c.spent, 0);
  const budget = fixas.reduce((a, c) => a + (c.budget ?? 0), 0);
  const pending = control.fixasPendentes;
  return (
    <Section title="Contas fixas">
      <div className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xl font-display tnum">
            <Eur cents={spent} />
          </span>
          {budget > 0 && (
            <span className={`text-sm tnum ${faint}`}>
              de <Eur cents={budget} />
            </span>
          )}
        </div>
        {budget > 0 ? (
          <>
            <div className="mt-2">
              <Bar value={spent} max={budget} level={spent > budget * 1.05 ? "warn" : "ok"} />
            </div>
            {pending.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className={`text-xs py-1 ${faint}`}>Por pagar:</span>
                {pending.map((f) => (
                  <span key={f.name} className="rounded-full bg-tinta/5 dark:bg-white/10 px-2.5 py-1 text-xs">
                    {f.name} <Eur cents={f.cents} className="font-medium" />
                  </span>
                ))}
              </div>
            ) : (
              <p className={`mt-2 text-sm ${POS}`}>✓ Todas pagas</p>
            )}
          </>
        ) : (
          <p className={`mt-1 text-sm ${faint}`}>
            Sem valores previstos.{" "}
            <Link to="/plano#fixas" className="text-petroleo dark:text-petroleo font-medium">
              Definir no Plano →
            </Link>
          </p>
        )}
      </div>
    </Section>
  );
}

function Mesadas({ rows }: { rows: MesadaRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Section title="Mesadas">
      <div className="grid grid-cols-2 gap-3">
        {rows.map((r) => {
          const done = r.mesada > 0 && r.alem === 0 && r.levou >= r.mesada;
          return (
            <div key={r.memberId} className={`card p-3.5 ${r.alem > 0 ? "border-terracota/40 bg-terracota/5" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="shrink-0 w-9 h-9 rounded-full bg-petroleo/15 text-petroleo dark:bg-petroleo/15 dark:text-petroleo flex items-center justify-center font-display text-lg" aria-hidden>
                  {r.name.charAt(0)}
                </span>
                <span className="min-w-0 truncate text-sm font-medium">{r.name}</span>
                {done && <span className={`ml-auto ${POS}`}>✓</span>}
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                <span className="text-xl font-display tnum">
                  <Eur cents={r.levou} />
                </span>
                {r.mesada > 0 && (
                  <span className={`text-xs tnum ${faint}`}>
                    de <Eur cents={r.mesada} />
                  </span>
                )}
              </div>
              {r.mesada > 0 && (
                <div className="mt-1.5">
                  <Bar value={r.levou} max={r.mesada} level={r.alem > 0 ? "over" : "ok"} />
                </div>
              )}
              <div className={`mt-1.5 text-xs ${r.alem > 0 ? NEG : faint}`}>
                {r.mesada === 0 ? (
                  "sem mesada este mês"
                ) : r.alem > 0 ? (
                  <>
                    <Eur cents={r.alem} /> além da mesada
                  </>
                ) : r.porSair > 0 ? (
                  <>
                    faltam <Eur cents={r.porSair} />
                  </>
                ) : (
                  "recebida"
                )}
                {r.pontual > 0 && (
                  <>
                    {" · +"}
                    <Eur cents={r.pontual} /> pontual
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Check({ done }: { done: boolean }) {
  return (
    <span
      aria-label={done ? "já entrou" : "por entrar"}
      className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
        done ? "bg-petroleo text-creme dark:text-tinta" : "border-2 border-tinta/20 dark:border-creme/25"
      }`}
    >
      {done ? "✓" : ""}
    </span>
  );
}

function Entradas({
  month,
  incomes,
  joanaDuet,
  joana,
  joanaArrived,
  duetLoading,
  total,
}: {
  month: string;
  incomes: IncomeProgress;
  joanaDuet: number | null;
  joana: JoanaGap | null;
  joanaArrived: number;
  duetLoading: boolean;
  total: number;
}) {
  const showJoana = month >= JOANA_FROM;
  return (
    <Section
      title="Entradas"
      right={
        <Link to={`/movimentos?mes=${month}&vista=entradas`} className="text-xs font-medium text-petroleo dark:text-petroleo">
          Ver todas →
        </Link>
      }
    >
      <div className="card px-5 py-2 divide-y divide-areia/60 dark:divide-white/10">
        {incomes.groups.map((g) => (
          <div key={g.kind} className="flex items-center gap-3 py-2.5">
            <Check done={g.pending === 0} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${g.pending === 0 ? "" : "font-medium"}`}>{g.label}</span>
              {g.pending > 0 && (
                <span className={`block text-xs ${faint}`}>
                  {g.arrived > 0 ? (
                    <>
                      faltam <Eur cents={g.pending} /> · dia {g.day}
                    </>
                  ) : (
                    `esperado no dia ${g.day}`
                  )}
                </span>
              )}
            </span>
            <Eur cents={g.pending === 0 ? g.arrived : g.expected} className={`shrink-0 ${g.pending === 0 ? "" : faint}`} />
          </div>
        ))}
        {showJoana && (
          <Link to="/meses/joana" className="flex items-center gap-3 py-2.5 active:opacity-60">
            <Check done={joana != null && joana.missing === 0 && (joanaDuet ?? 0) > 0} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">Joana</span>
              <span className={`block text-xs ${faint}`}>
                {joanaDuet != null && joana ? (
                  joana.missing > 0 ? (
                    <>
                      recebeu <Eur cents={joanaDuet} /> na Duet · faltam <Eur cents={joana.missing} />
                    </>
                  ) : joana.waived > 0 ? (
                    "o resto não é dívida"
                  ) : (
                    <>
                      recebeu <Eur cents={joanaDuet} /> na Duet
                    </>
                  )
                ) : duetLoading ? (
                  "a ver a Duet…"
                ) : (
                  "sem dados da Duet"
                )}
              </span>
            </span>
            <Eur cents={joanaArrived} className="shrink-0" />
          </Link>
        )}
        {incomes.groups.length === 0 && !showJoana && (
          <p className="py-3 text-sm">
            Ainda não há entradas previstas.{" "}
            <Link to="/plano#entradas" className="font-medium text-petroleo dark:text-petroleo">
              Adicionar no Plano →
            </Link>
          </p>
        )}
        <div className="flex items-baseline justify-between gap-3 py-2.5 font-semibold">
          <span>Já entrou este mês</span>
          <Eur cents={total} />
        </div>
      </div>
    </Section>
  );
}
