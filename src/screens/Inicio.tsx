import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useHousehold } from "@/data/household";
import { useEngineData, type EngineData } from "@/data/engine";
import { useDuetMonth, type DuetMonth } from "@/data/duet";
import { useJoanaWaivers } from "@/data/incomes";
import { buildMonthsView, type MonthsView } from "@/lib/view";
import { avisos, modelMonth, monthControl, planTotals, type Aviso, type CategoryControl, type MonthControl } from "@/lib/plan";
import { JOANA_FROM, type MonthBreakdown } from "@/lib/month";
import { mesadaFor } from "@/lib/mesadas";
import { joanaGap } from "@/lib/meses";
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
  type MesadaRow,
  type ReviewCount,
  type StatusNote,
} from "@/lib/esteMes";
import { formatEuros, monthDay, monthName, monthTitle } from "@/lib/format";
import { Bar, Eur, Loading, Pill, Section } from "@/components/kit";
import { ForecastCard } from "@/components/ForecastCard";

const muted = "text-tinta/60 dark:text-creme/60";
const faint = "text-tinta/50 dark:text-creme/50";
const POS = "text-petroleo dark:text-teal-300";
const NEG = "text-terracota dark:text-orange-300";
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

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Header month={month} />
        <StatusLine notes={bankNotes(data.lastSyncAt, data.consentUntil, Date.now())} review={reviewCount(data.txs, month)} />
      </div>
      {error && <p className="text-sm text-terracota dark:text-orange-300">Não consegui atualizar: {error}</p>}
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
  red: "text-terracota dark:text-orange-300",
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
          className="inline-block rounded-full border border-terracota/40 bg-terracota/5 px-3 py-1 text-xs font-medium text-terracota dark:text-orange-300 active:opacity-60"
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
      <span className="shrink-0 text-sm font-medium text-petroleo dark:text-teal-300">Ver →</span>
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
                    s.done ? "bg-petroleo text-creme" : "border-2 border-tinta/20 dark:border-creme/25"
                  }`}
                >
                  {s.done ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${s.done ? muted : "font-medium"}`}>{s.label}</span>
                  <span className={`block truncate text-xs ${s.done ? faint : s.key === "categorizar" ? "text-terracota dark:text-orange-300" : faint}`}>{s.sub}</span>
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
          <Link to={`/meses/${month}`} className="block text-sm font-medium text-petroleo dark:text-teal-300">
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
              <Link to="/plano#mesadas" className="font-medium text-petroleo dark:text-teal-300">
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

const AVISO_DOT: Record<Aviso["level"], string> = {
  over: "bg-terracota",
  warn: "bg-amber-500",
  info: "bg-tinta/30 dark:bg-creme/40",
};

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
  const list = avisos(
    control,
    sem,
    mesadaOf,
    incomes.missing.map((g) => ({ label: g.label, day: g.day, cents: g.pending })),
  ).slice(0, 3);
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
  const paceOver = control.diaProjected > control.diaLimit;
  const expectedIn = incomes.arrived + (month >= JOANA_FROM ? joanaArrived : 0);

  return (
    <>
      <section className="card p-5 bg-petroleo/5 border-petroleo/20 dark:bg-petroleo/10">
        {ensaio && (
          <div className="mb-2">
            <Pill tone="amber">A experimentar — o plano começa em {monthName(plan.start_month)}</Pill>
          </div>
        )}
        {over ? (
          <>
            <p className={muted}>Passaram o limite do dia a dia em</p>
            <p className="text-5xl font-display tnum text-terracota dark:text-orange-300">
              <Eur cents={-control.diaLeft} />
            </p>
            <p className={`text-sm mt-1 ${muted}`}>
              Limite <Eur cents={control.diaLimit} /> · já gastaram <Eur cents={control.diaSpent} />
            </p>
          </>
        ) : (
          <>
            <p className={muted}>Ainda podem gastar</p>
            <p className="text-5xl font-display tnum text-petroleo dark:text-teal-300">
              <Eur cents={control.diaLeft} />
            </p>
            <p className={`text-sm mt-1 ${muted}`}>
              no dia a dia até {monthDay(month, "last")}
              {control.daysLeft > 1 ? ` · cerca de ${formatEuros(control.perDay)}/dia` : " · é o último dia"}
            </p>
          </>
        )}
        {control.day >= 7 && control.day < dim && control.diaSpent > 0 && (
          <p className={`text-xs mt-2 ${paceOver ? "text-amber-700 dark:text-amber-300" : faint}`}>
            Ao ritmo de agora, o dia a dia acaba em <Eur cents={control.diaProjected} /> (limite <Eur cents={control.diaLimit} />).
          </p>
        )}
        {semSaiu.banco > 0 && (
          <p className="text-xs mt-2 text-amber-700 dark:text-amber-300">
            <Eur cents={semSaiu.banco} /> ainda sem categoria não contam aqui.{" "}
            <Link to={`/movimentos?mes=${month}&vista=categorizar`} className="font-medium underline underline-offset-2">
              Categorizar
            </Link>
          </p>
        )}
        {semSaiu.applePay > 0 && (
          <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
            <Eur cents={semSaiu.applePay} /> do Apple Pay sem categoria também não contam.{" "}
            <Link to={`/movimentos?mes=${month}&vista=todos`} className="font-medium underline underline-offset-2">
              Ver
            </Link>
          </p>
        )}
        {pontualDia > 0 && (
          <p className={`text-xs mt-1 ${faint}`}>
            Os gastos pontuais (<Eur cents={pontualDia} />) não contam para o limite.
          </p>
        )}
      </section>

      {list.length > 0 && (
        <Section title="Avisos">
          <ul className="card p-4 space-y-2 text-sm">
            {list.map((a) => (
              <li key={a.text} className="flex items-start gap-2.5">
                <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${AVISO_DOT[a.level]}`} />
                <span className="min-w-0">{a.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Por área">
        <div className="card p-5 space-y-5">
          <Fixas control={control} />
          <DiaADia control={control} tick={tick} month={month} covers={plan.mesada_covers} />
          <Trabalho control={control} tick={tick} month={month} />
          <Mesadas rows={mesadas} />
        </div>
      </Section>

      <Section title="Entradas">
        <div className="card p-5 space-y-1.5 text-sm">
          {incomes.groups.length > 0 ? (
            <>
              <p>
                Entrou <Eur cents={incomes.arrived} className="font-semibold" /> de <Eur cents={incomes.expected} /> esperados
              </p>
              {incomes.missing.length > 0 ? (
                <p className={muted}>
                  Falta:{" "}
                  {incomes.missing.map((g, i) => (
                    <span key={g.kind}>
                      {i > 0 && " · "}
                      {g.label}
                      {g.arrived > 0 && (
                        <>
                          {" "}
                          <Eur cents={g.pending} />
                        </>
                      )}{" "}
                      (dia {g.day})
                    </span>
                  ))}
                </p>
              ) : (
                <p className="text-petroleo dark:text-teal-300">✓ Já entrou tudo o que era esperado</p>
              )}
            </>
          ) : (
            <p>
              Ainda não há entradas previstas.{" "}
              <Link to="/plano#entradas" className="font-medium text-petroleo dark:text-teal-300">
                Adicionar no Plano →
              </Link>
            </p>
          )}
          {month >= JOANA_FROM &&
            (joanaDuet != null && joana ? (
              <Link to="/meses/joana" className="block active:opacity-60">
                Joana: <Eur cents={joanaDuet} /> na Duet este mês · chegou <Eur cents={joanaArrived} />
                {joana.missing > 0 ? (
                  <span className={NEG}>
                    {" "}
                    · faltam <Eur cents={joana.missing} />
                  </span>
                ) : joana.waived > 0 ? (
                  <span className={faint}> · o resto não é dívida</span>
                ) : (
                  joanaDuet > 0 && <span className={POS}> ✓</span>
                )}
                <span className={POS}> →</span>
              </Link>
            ) : (
              <Link to="/meses/joana" className="block active:opacity-60">
                Joana: <Eur cents={joanaArrived} /> na conta este mês
                <span className={faint}>{duet === null ? " · a ver a Duet…" : " · sem dados da Duet"}</span>
                <span className={POS}> →</span>
              </Link>
            ))}
          {real.entrou !== expectedIn && (
            <p className={`text-xs ${faint}`}>
              Ao todo entrou <Eur cents={real.entrou} /> este mês.
            </p>
          )}
          <Link to={`/movimentos?mes=${month}&vista=entradas`} className="block pt-1 text-xs font-medium text-petroleo dark:text-teal-300">
            Ver as entradas →
          </Link>
        </div>
      </Section>

      <Section title="Fim do mês">
        <ForecastCard month={month} balanceToday={data.balanceCents} toCome={forecast.toCome} toGo={forecast.toGo} />
      </Section>

      {control.day <= 5 && lastClosed && <ClosedLink b={lastClosed} />}
    </>
  );
}

function AreaHead({ title, right }: { title: string; right: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-1.5">
      <span className="font-medium min-w-0 truncate">{title}</span>
      <span className="shrink-0 text-sm tnum">{right}</span>
    </div>
  );
}

function Fixas({ control }: { control: MonthControl }) {
  const fixas = control.categorias.filter((c) => c.grp === "fixa");
  const spent = fixas.reduce((a, c) => a + c.spent, 0);
  const budget = fixas.reduce((a, c) => a + (c.budget ?? 0), 0);
  return (
    <div>
      <AreaHead
        title="Contas fixas"
        right={
          budget > 0 ? (
            <>
              <Eur cents={spent} /> <span className={faint}>de</span> <Eur cents={budget} />
            </>
          ) : (
            <Eur cents={spent} />
          )
        }
      />
      {budget > 0 && <Bar value={spent} max={budget} level={spent > budget * 1.05 ? "warn" : "ok"} />}
      <p className={`mt-1 text-xs ${faint}`}>
        {budget === 0 ? (
          <>
            Sem valores previstos.{" "}
            <Link to="/plano#fixas" className="text-petroleo dark:text-teal-300 font-medium">
              Plano →
            </Link>
          </>
        ) : control.fixasPendentes.length > 0 ? (
          <>
            Faltam:{" "}
            {control.fixasPendentes.map((f, i) => (
              <span key={f.name}>
                {i > 0 && " · "}
                {f.name} <Eur cents={f.cents} />
              </span>
            ))}
          </>
        ) : (
          "✓ Todas pagas"
        )}
      </p>
    </div>
  );
}

function CatBar({ c, tick, month }: { c: CategoryControl; tick: number; month: string }) {
  return (
    <Link to={`/movimentos?mes=${month}&cat=${c.categoryId}`} className="block active:opacity-60">
      <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
        <span className="min-w-0 truncate">{c.name}</span>
        <span className="shrink-0 tnum">
          <Eur cents={c.spent} className={c.level === "over" ? "text-terracota dark:text-orange-300" : ""} /> <span className={faint}>/ <Eur cents={c.budget ?? 0} /></span>
        </span>
      </div>
      <Bar value={c.spent} max={c.budget ?? 0} tick={tick} level={c.level} />
    </Link>
  );
}

function DiaADia({ control, tick, month, covers }: { control: MonthControl; tick: number; month: string; covers: string[] }) {
  const [open, setOpen] = useState(false);
  const dia = control.categorias.filter((c) => c.grp === "variavel");
  const limited = dia.filter((c) => (c.budget ?? 0) > 0);
  const free = dia.filter((c) => !((c.budget ?? 0) > 0) && c.spent !== 0);
  const freeTotal = free.reduce((a, c) => a + c.spent, 0);
  return (
    <div>
      <AreaHead
        title="Dia a dia"
        right={
          <>
            <Eur cents={control.diaSpent} /> <span className={faint}>de</span> <Eur cents={control.diaLimit} />
          </>
        }
      />
      <div className="space-y-2.5">
        {limited.map((c) => (
          <CatBar key={c.categoryId} c={c} tick={tick} month={month} />
        ))}
      </div>
      {free.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`text-xs ${muted} active:opacity-60`}>
            +{free.length} sem limite: <Eur cents={freeTotal} /> {open ? "▾" : "▸"}
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {free.map((c) => (
                <li key={c.categoryId}>
                  <Link to={`/movimentos?mes=${month}&cat=${c.categoryId}`} className="flex justify-between gap-3 py-0.5 active:opacity-60">
                    <span className={`min-w-0 truncate ${muted}`}>
                      {c.name}
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
    </div>
  );
}

function Trabalho({ control, tick, month }: { control: MonthControl; tick: number; month: string }) {
  const cats = control.categorias.filter((c) => c.grp === "atividade" && ((c.budget ?? 0) > 0 || c.spent !== 0));
  if (cats.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {cats.map((c) =>
        (c.budget ?? 0) > 0 ? (
          <CatBar key={c.categoryId} c={c} tick={tick} month={month} />
        ) : (
          <AreaHead key={c.categoryId} title={c.name} right={<Eur cents={c.spent} />} />
        ),
      )}
    </div>
  );
}

function Mesadas({ rows }: { rows: MesadaRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="font-medium mb-1.5">Mesadas</div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.memberId}>
            <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="shrink-0 tnum">
                {r.mesada > 0 ? (
                  <>
                    <Eur cents={r.levou} className={r.alem > 0 ? "text-terracota dark:text-orange-300" : ""} /> <span className={faint}>de</span> <Eur cents={r.mesada} />
                    {r.alem === 0 && r.levou >= r.mesada && <span className="text-petroleo dark:text-teal-300"> ✓</span>}
                  </>
                ) : r.levou !== 0 ? (
                  <>
                    levou <Eur cents={r.levou} />
                  </>
                ) : (
                  <span className={faint}>sem mesada este mês</span>
                )}
              </span>
            </div>
            {r.mesada > 0 && <Bar value={r.levou} max={r.mesada} level={r.alem > 0 ? "over" : "ok"} />}
            {r.alem > 0 && (
              <p className="mt-1 text-xs text-terracota dark:text-orange-300">
                {r.name} levou <Eur cents={r.levou} /> (<Eur cents={r.alem} /> além da mesada)
              </p>
            )}
            {r.mesada === 0 && r.levou !== 0 && <p className={`mt-0.5 text-xs ${faint}`}>Sem mesada este mês.</p>}
            {r.pontual > 0 && (
              <p className={`mt-0.5 text-xs ${faint}`}>
                + <Eur cents={r.pontual} /> pontual, à parte
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
