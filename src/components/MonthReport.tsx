import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { displayMerchant } from "@shared/categorize";
import { setPontual } from "@/data/transactions";
import type { EngineData } from "@/data/engine";
import { errorMessage } from "@/lib/errors";
import { formatEuros, monthName, monthTitle } from "@/lib/format";
import {
  balanceEnds,
  casaArrendada,
  dayShort,
  expectedByLine,
  howItCame,
  incomeTag,
  mesadaStatus,
  missingIncomes,
  type IncomeTag,
} from "@/lib/meses";
import {
  JOANA_FROM,
  lineLabel,
  makeResolver,
  METHOD_LABELS,
  topMerchants,
  type CategoryLine,
  type EngineTx,
  type Method,
  type MonthBreakdown,
} from "@/lib/month";
import { modelMonth, planMesada } from "@/lib/plan";
import type { MonthsView } from "@/lib/view";
import { AREA_COLORS, Eur, Pill, Section, StackedBar } from "./kit";
import { JoanaDuetCard } from "./JoanaDuetCard";

export type ReportMode = "real" | "modelo";

const muted = "text-tinta/50 dark:text-creme/50";
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const txDesc = (t: Pick<EngineTx, "description_raw"> | undefined) => (t ? displayMerchant(t.description_raw) || t.description_raw || "—" : "—");

/** Label … amount; unlike kit's Row the sub-line wraps (it says how). */
function Line({
  label,
  sub,
  right,
  strong = false,
  to,
  onClick,
  children,
}: {
  label: ReactNode;
  sub?: ReactNode;
  right: ReactNode;
  strong?: boolean;
  to?: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${strong ? "font-semibold" : ""}`}>{label}</span>
        {sub && <span className={`block text-xs ${muted} break-words`}>{sub}</span>}
      </span>
      <span className={`shrink-0 text-right tnum ${strong ? "font-semibold" : ""}`}>{right}</span>
    </>
  );
  const cls = "flex items-start justify-between gap-3 py-2";
  return (
    <div>
      {to ? (
        <Link to={to} className={`${cls} active:opacity-60`}>
          {inner}
        </Link>
      ) : onClick ? (
        <button onClick={onClick} className={`${cls} w-full text-left active:opacity-60`}>
          {inner}
        </button>
      ) : (
        <div className={cls}>{inner}</div>
      )}
      {children}
    </div>
  );
}

function Tag({ tag }: { tag: IncomeTag }) {
  const cls = {
    ok: "text-petroleo",
    warn: "text-amber-700 dark:text-amber-300",
    info: "text-tinta/60 dark:text-creme/60",
  }[tag.tone];
  return <span className={`font-medium ${cls}`}>{tag.text}</span>;
}

function Banner({ children, to, action }: { children: ReactNode; to: string; action: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm text-amber-800 dark:text-amber-200 min-w-0">{children}</p>
      <Link to={to} className="shrink-0 rounded-full bg-tinta text-creme dark:bg-creme dark:text-tinta px-3 py-1.5 text-sm font-medium">
        {action}
      </Link>
    </div>
  );
}

function StatusPill({ b, firstDataDate }: { b: MonthBreakdown; firstDataDate: string | null }) {
  if (b.status === "completo") return <Pill tone="green">Completo</Pill>;
  if (b.status === "provisorio") return <Pill tone="amber">Provisório · {b.semCount} sem categoria</Pill>;
  if (b.status === "a_decorrer") return <Pill>A decorrer</Pill>;
  const since = firstDataDate ? ` · dados desde ${Number(firstDataDate.slice(8, 10))} ${monthName(firstDataDate.slice(0, 7)).slice(0, 3)}` : "";
  return <Pill>Mês incompleto{since}</Pill>;
}

/**
 * One month, clearly: how much came in and how, how much went out and where,
 * how much was left. "Com o modelo" redoes it as if the plan were in place.
 */
export function MonthReport({
  data,
  view,
  month,
  mode,
  semPontuais,
  reload,
}: {
  data: EngineData;
  view: MonthsView;
  month: string;
  mode: ReportMode;
  /** Use the month without its one-off movements. */
  semPontuais: boolean;
  reload: () => Promise<void>;
}) {
  const real = view.real.get(month)!;
  const sp = view.semPontuais.get(month)!;
  // The model always works without the one-offs; so do the details under it.
  const b = mode === "modelo" || semPontuais ? sp : real;
  const resolve = useMemo(() => makeResolver(data.allCategories), [data]);
  const txById = useMemo(() => new Map(data.txs.map((t) => [t.id, t])), [data]);
  const hasPontuais = real.pontualIn + real.pontualOut > 0;
  const semAmount = real.semIds.reduce((a, id) => a + Math.abs(txById.get(id)?.amount_cents ?? 0), 0);
  const q = (vista: string) => `/movimentos?mes=${month}&vista=${vista}`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <StatusPill b={real} firstDataDate={data.ctx.firstDataDate} />
        {real.semCount > 0 && (
          <Banner to={q("categorizar")} action="Categorizar">
            Faltam categorizar {real.semCount} {real.semCount === 1 ? "movimento" : "movimentos"} ({formatEuros(semAmount)}). Até lá, os totais estão incompletos.
          </Banner>
        )}
        {real.porValidar > 0 && (
          <Banner to={q("validar")} action="Confirmar">
            {real.porValidar} {real.porValidar === 1 ? "categoria sugerida" : "categorias sugeridas"} pela app por confirmar.
          </Banner>
        )}
      </div>

      {mode === "real" ? (
        <RealHero b={b} real={real} view={view} month={month} semPontuais={semPontuais} />
      ) : (
        <ModelHero sp={sp} data={data} month={month} hasPontuais={hasPontuais} status={real.status} />
      )}

      {mode === "real" && <Entradas b={b} data={data} month={month} />}

      <ParaOndeFoi b={b} data={data} month={month} txById={txById} />

      <ComoSaiu metodo={b.metodo} />

      <Maiores b={b} categoryName={(id) => resolve(id)?.name ?? "Sem categoria"} reload={reload} />

      <Link to={q("todos")} className="block text-center text-sm font-medium text-petroleo py-2">
        Ver os {real.txCount} movimentos de {monthName(month)} →
      </Link>
    </div>
  );
}

// ── Hero: real ──────────────────────────────────────────────────────────────

function RealHero({ b, real, view, month, semPontuais }: { b: MonthBreakdown; real: MonthBreakdown; view: MonthsView; month: string; semPontuais: boolean }) {
  const running = b.status === "a_decorrer";
  const left = b.sobrou >= 0;
  const bal = balanceEnds(view.endBalance, view.months, month);
  const savings = [
    b.poupancaPara > 0 && `${formatEuros(b.poupancaPara)} passaram para a poupança`,
    b.poupancaDe > 0 && `vieram ${formatEuros(b.poupancaDe)} da poupança`,
  ].filter(Boolean) as string[];
  const pontuais = [real.pontualIn > 0 && `entrou ${formatEuros(real.pontualIn)}`, real.pontualOut > 0 && `saiu ${formatEuros(real.pontualOut)}`].filter(Boolean);

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h2 className="text-lg">
          {monthTitle(month)}
          {running && " (até hoje)"}
          {semPontuais && " (sem pontuais)"}
        </h2>
        <p className={`text-3xl font-display tnum ${left ? "text-petroleo" : "text-terracota"}`}>
          {running ? (left ? "Até hoje sobraram" : "Até hoje faltaram") : left ? "Sobraram" : "Faltaram"} {formatEuros(Math.abs(b.sobrou))}
        </p>
      </div>
      <div className="text-sm divide-y divide-areia/60 dark:divide-white/5">
        <Line label="Entrou" right={<Eur cents={b.entrou} signed tone="pos" />} />
        <Line
          label="Casa"
          sub={`contas fixas ${formatEuros(b.fixas)} · dia a dia ${formatEuros(b.dia)} · trabalho da Joana ${formatEuros(b.trabalho)}`}
          right={<Eur cents={-b.casa} signed />}
        />
        <Line label="Para vocês" right={<Eur cents={-b.voces} signed />} />
        {b.semSaiu > 0 && <Line label="Sem categoria" right={<Eur cents={-b.semSaiu} signed />} />}
        <Line label={left ? "= Sobrou" : "= Faltou"} strong right={<Eur cents={b.sobrou} signed tone="auto" />} />
      </div>
      {(bal || savings.length > 0) && (
        <p className={`text-xs ${muted}`}>
          {bal && (
            <>
              Saldo da conta: {bal.start != null && <>{dayShort(month, "first")} {formatEuros(bal.start)} → </>}
              {month === view.current ? "hoje" : dayShort(month, "last")} {formatEuros(bal.end)}
            </>
          )}
          {bal && savings.length > 0 && " · "}
          {savings.join(" · ")}
        </p>
      )}
      {!semPontuais && pontuais.length > 0 && <Pill>Inclui extras pontuais: {pontuais.join(", ")}</Pill>}
    </div>
  );
}

// ── Hero: com o modelo ──────────────────────────────────────────────────────

function ModelHero({ sp, data, month, hasPontuais, status }: { sp: MonthBreakdown; data: EngineData; month: string; hasPontuais: boolean; status: MonthBreakdown["status"] }) {
  const mm = modelMonth(sp, data.incomes, data.plan, data.members);
  const left = mm.sobra >= 0;
  const noMesadas = Object.keys(data.plan.mesadas).length === 0;
  const joanaLabel = month >= data.plan.start_month ? "Joana (valor do plano)" : lineLabel("joana", month);
  const entradas: [string, number][] = [
    ["Ordenado do João (normal)", mm.entradas.ordenado],
    ["Despesas de representação", mm.entradas.representacao],
    ["Renda da casa arrendada", mm.entradas.renda],
    [joanaLabel, mm.entradas.joana],
    ["Outras entradas", mm.entradas.outras],
  ];

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h2 className="text-lg">{cap(monthName(month))} com o modelo</h2>
        <p className={`text-2xl font-display tnum ${left ? "text-petroleo" : "text-terracota"}`}>
          Com o modelo tinham {left ? "sobrado" : "faltado"} {formatEuros(Math.abs(mm.sobra))}
        </p>
      </div>
      <div className="text-sm divide-y divide-areia/60 dark:divide-white/5">
        <Line label="Entrava" right={<Eur cents={mm.entrou} signed tone="pos" />}>
          <div className="pb-2 -mt-1 text-xs text-tinta/60 dark:text-creme/60">
            {entradas
              .filter(([, c]) => c !== 0)
              .map(([label, c]) => (
                <div key={label} className="flex justify-between gap-3 pl-2">
                  <span className="min-w-0 truncate">{label}</span>
                  <Eur cents={c} className="shrink-0" />
                </div>
              ))}
          </div>
        </Line>
        <Line label="Casa" right={<Eur cents={-mm.casa} signed />} />
        {mm.semSaiu > 0 && <Line label="Sem categoria" right={<Eur cents={-mm.semSaiu} signed />} />}
        <Line
          label="Mesadas"
          sub={mm.pessoas.map((p) => `${p.name} ${formatEuros(p.modelo)}`).join(" + ")}
          right={<Eur cents={-mm.mesadas} signed />}
        />
        <Line label={left ? "= Sobrava" : "= Faltava"} strong right={<Eur cents={mm.sobra} signed tone="auto" />} />
      </div>
      <p className="text-sm">
        Na realidade {mm.sobrouReal >= 0 ? "sobrou" : "faltou"} <Eur cents={Math.abs(mm.sobrouReal)} className="font-medium" />
        {hasPontuais && " (sem os extras pontuais)"}.
      </p>
      <div className="text-sm space-y-0.5">
        {mm.pessoas.map((p) => (
          <p key={p.memberId}>
            {p.name} levou <Eur cents={p.levou} className="font-medium" /> · no modelo <Eur cents={p.modelo} className="font-medium" />
          </p>
        ))}
      </div>
      {noMesadas && (
        <p className="text-sm rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-200 px-3 py-2">
          Ainda não há mesadas no plano — conta com 0 €.{" "}
          <Link to="/plano#mesadas" className="font-medium underline">
            Define-as no Plano →
          </Link>
        </p>
      )}
      {status === "a_decorrer" && <p className="text-xs text-amber-700 dark:text-amber-300">O mês ainda não acabou: o modelo já conta com as entradas do mês inteiro.</p>}
      <p className={`text-xs ${muted}`}>
        Ordenado normal (sem prémio), representação e renda no valor do mês, o que a Joana pôs na conta, a casa real e as mesadas do plano.
      </p>
    </div>
  );
}

// ── O que entrou ────────────────────────────────────────────────────────────

function Entradas({ b, data, month }: { b: MonthBreakdown; data: EngineData; month: string }) {
  const expected = expectedByLine(data.incomes, month);
  const lines = b.entradas.filter((l) => l.cents !== 0);
  const joanaLine = lines.find((l) => l.key === "joana");
  const duet = month >= JOANA_FROM ? <JoanaDuetCard month={month} bankCents={joanaLine?.cents ?? 0} /> : null;
  const missing = b.status === "parcial" ? [] : missingIncomes(b.entradas, data.incomes, month);
  const running = b.status === "a_decorrer";

  return (
    <Section title="O que entrou" right={<Eur cents={b.entrou} className="font-semibold" />}>
      <div className="card px-4 py-2 text-sm divide-y divide-areia/60 dark:divide-white/5">
        {lines.length === 0 && <p className={`py-2 ${muted}`}>Ainda não entrou nada este mês.</p>}
        {lines.map((l) => {
          const tag = incomeTag(l.key, l.cents, expected.get(l.key)?.cents ?? 0);
          return (
            <Line
              key={l.key}
              label={l.label}
              to={`/movimentos?mes=${month}&vista=entradas&linha=${l.key}`}
              sub={
                <>
                  {howItCame(l)}
                  {tag && (
                    <>
                      {" · "}
                      <Tag tag={tag} />
                    </>
                  )}
                </>
              }
              right={<Eur cents={l.cents} />}
            >
              {l.key === "joana" && month < JOANA_FROM && (
                <p className={`text-xs ${muted} pb-2 -mt-1`}>Antes de novembro a Joana ainda não passava tudo para a conta — não é dívida.</p>
              )}
              {l.key === "joana" && duet && <div className="pb-2">{duet}</div>}
            </Line>
          );
        })}
        {!joanaLine && duet && <div className="py-2">{duet}</div>}
      </div>
      {missing.length > 0 && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300 space-y-0.5 px-1">
          {missing.map((m) => (
            <p key={`${m.key}-${m.label}`}>
              {running ? "Ainda não entrou" : "Faltou entrar"}: {m.label} {formatEuros(m.cents)} (costuma ser dia {m.day})
            </p>
          ))}
          <p className={muted}>Não está somado acima.</p>
        </div>
      )}
    </Section>
  );
}

// ── Para onde foi ───────────────────────────────────────────────────────────

function AreaCard({ title, cents, children }: { title: string; cents: number; children: ReactNode }) {
  return (
    <div className="card px-4 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-3 pb-1">
        <h3 className="font-semibold text-base">{title}</h3>
        <Eur cents={cents} className="font-semibold" />
      </div>
      {children}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ParaOndeFoi({ b, data, month, txById }: { b: MonthBreakdown; data: EngineData; month: string; txById: Map<string, EngineTx> }) {
  const saiu = b.casa + b.voces + b.semSaiu;
  const of = (area: CategoryLine["area"]) => b.categorias.filter((c) => c.area === area);
  const fixas = of("fixa");
  const dia = of("dia");
  const trabalho = of("trabalho");
  const arrendada = casaArrendada(b);
  const catLink = (id: string) => `/movimentos?mes=${month}&cat=${id}`;

  return (
    <Section title="Para onde foi" right={<Eur cents={saiu} className="font-semibold" />}>
      <div className="space-y-3">
        <div className="card p-4">
          <StackedBar
            parts={[
              { key: "fixa", label: "Contas fixas", cents: b.fixas, color: AREA_COLORS.fixa },
              { key: "dia", label: "Dia a dia", cents: b.dia, color: AREA_COLORS.dia },
              { key: "trabalho", label: "Trabalho da Joana", cents: b.trabalho, color: AREA_COLORS.trabalho },
              { key: "voces", label: "Para vocês", cents: b.voces, color: AREA_COLORS.voces },
              { key: "sem", label: "Sem categoria", cents: b.semSaiu, color: AREA_COLORS.sem },
            ]}
          />
          {saiu <= 0 && <p className={`text-sm ${muted}`}>Ainda não saiu nada este mês.</p>}
        </div>

        <AreaCard title="Contas fixas" cents={b.fixas}>
          {fixas.length === 0 && <p className={`py-1 ${muted}`}>Nenhuma conta fixa paga.</p>}
          <div className="divide-y divide-areia/60 dark:divide-white/5">
            {fixas.map((c) => (
              <Line key={c.categoryId} label={c.name} sub={`${c.count} mov.`} right={<Eur cents={c.cents} />} to={catLink(c.categoryId)} />
            ))}
          </div>
          {arrendada && (
            <p className={`pt-2 text-xs ${muted}`}>
              Casa arrendada: renda {formatEuros(arrendada.renda)} − prestação {formatEuros(arrendada.prestacao)} ={" "}
              <Eur cents={arrendada.saldo} tone="auto" className="font-medium" />
            </p>
          )}
        </AreaCard>

        <AreaCard title="Dia a dia" cents={b.dia}>
          {dia.length === 0 && <p className={`py-1 ${muted}`}>Nada no dia a dia.</p>}
          <div className="divide-y divide-areia/60 dark:divide-white/5">
            {dia.map((c) => (
              <DiaRow key={c.categoryId} c={c} total={b.dia} txs={data.txs} link={catLink(c.categoryId)} />
            ))}
          </div>
        </AreaCard>

        {(b.trabalho !== 0 || trabalho.length > 0) && (
          <AreaCard title="Trabalho da Joana" cents={b.trabalho}>
            {trabalho.length === 1 ? (
              <Link to={catLink(trabalho[0].categoryId)} className={`block text-xs ${muted} active:opacity-60`}>
                {plural(trabalho[0].count, "movimento", "movimentos")} · ver →
              </Link>
            ) : (
              <div className="divide-y divide-areia/60 dark:divide-white/5">
                {trabalho.map((c) => (
                  <Line key={c.categoryId} label={c.name} sub={`${c.count} mov.`} right={<Eur cents={c.cents} />} to={catLink(c.categoryId)} />
                ))}
              </div>
            )}
          </AreaCard>
        )}

        <ParaVoces b={b} data={data} month={month} txById={txById} />

        {b.semCount > 0 && (
          <Link to={`/movimentos?mes=${month}&vista=categorizar`} className="card px-4 py-3 text-sm flex items-center justify-between gap-3 active:opacity-60">
            <span className="min-w-0">
              <span className="block font-semibold text-base">Sem categoria</span>
              <span className={`block text-xs ${muted}`}>{plural(b.semCount, "movimento", "movimentos")} · categorizar →</span>
            </span>
            <Eur cents={b.semSaiu} className="font-semibold shrink-0" />
          </Link>
        )}

        {(b.poupancaPara !== 0 || b.poupancaDe !== 0) && (
          <div className="card px-4 py-3 text-sm">
            <p>
              <span className="font-semibold">Poupança:</span>
              {b.poupancaPara !== 0 && (
                <>
                  {" "}
                  para a poupança <Eur cents={b.poupancaPara} className="font-medium" />
                </>
              )}
              {b.poupancaPara !== 0 && b.poupancaDe !== 0 && " ·"}
              {b.poupancaDe !== 0 && (
                <>
                  {" "}
                  da poupança <Eur cents={b.poupancaDe} className="font-medium" />
                </>
              )}
            </p>
            <p className={`text-xs ${muted}`}>Não conta como saída: o dinheiro continua a ser vosso.</p>
          </div>
        )}
      </div>
    </Section>
  );
}

function DiaRow({ c, total, txs, link }: { c: CategoryLine; total: number; txs: EngineTx[]; link: string }) {
  const [open, setOpen] = useState(false);
  const shops = useMemo(() => (open ? topMerchants(txs, c.txIds) : []), [open, txs, c.txIds]);
  const pct = total > 0 ? Math.round((c.cents / total) * 100) : 0;
  return (
    <Line
      label={
        <>
          {c.name} <span className="text-tinta/40 dark:text-creme/40">{open ? "▾" : "▸"}</span>
        </>
      }
      sub={
        <>
          {c.count} mov. · {pct} %
          {c.refundCents > 0 && <> · −{formatEuros(c.refundCents)} devolvido</>}
        </>
      }
      right={<Eur cents={c.cents} />}
      onClick={() => setOpen((o) => !o)}
    >
      {open && (
        <div className="mb-2 rounded-2xl bg-areia/40 dark:bg-white/5 px-3 py-2 text-xs space-y-1">
          <p className={`font-medium ${muted}`}>Onde</p>
          {shops.map((s) => (
            <div key={s.key} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {s.label} <span className={muted}>· {s.count}×</span>
              </span>
              <Eur cents={s.cents} className="shrink-0" />
            </div>
          ))}
          <Link to={link} className="inline-block pt-1 font-medium text-petroleo">
            Ver os movimentos →
          </Link>
        </div>
      )}
    </Line>
  );
}

const PERSON_ROWS = 5;

function ParaVoces({ b, data, month, txById }: { b: MonthBreakdown; data: EngineData; month: string; txById: Map<string, EngineTx> }) {
  const [all, setAll] = useState<Record<string, boolean>>({});
  const planOn = month >= data.plan.start_month;
  return (
    <AreaCard title="Para vocês" cents={b.voces}>
      {!planOn && <p className={`text-xs ${muted} pb-1`}>Até {monthName(data.plan.start_month)} isto não são mesadas: é o que cada um passou para si.</p>}
      <div className="divide-y divide-areia/60 dark:divide-white/5">
        {b.pessoas.map((p) => {
          const key = p.memberId ?? "?";
          const rows = p.txIds
            .map((id) => txById.get(id))
            .filter((t): t is EngineTx => !!t)
            .sort((x, y) => x.booking_date.localeCompare(y.booking_date));
          const shown = all[key] ? rows : rows.slice(0, PERSON_ROWS);
          const mesada = p.memberId ? planMesada(data.plan, p.memberId, month) : 0;
          const st = mesadaStatus(mesada, p.net);
          return (
            <div key={key} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{p.name}</span>
                <Eur cents={p.net} className="font-medium" />
              </div>
              {planOn && p.memberId && (
                <p className="text-xs">
                  {mesada > 0 ? (
                    <>
                      Mesada {formatEuros(st.dentro)} de {formatEuros(mesada)}
                      {st.completa && <span className="text-petroleo"> ✓</span>} ·{" "}
                      <span className={st.alem > 0 ? "text-terracota font-medium" : ""}>além da mesada {formatEuros(st.alem)}</span>
                    </>
                  ) : (
                    <span className={muted}>Sem mesada no plano · além da mesada {formatEuros(st.alem)}</span>
                  )}
                </p>
              )}
              {rows.length === 0 && <p className={`text-xs ${muted}`}>Nada este mês.</p>}
              <div className="mt-1 space-y-0.5">
                {shown.map((t) => (
                  <div key={t.id} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-tinta/70 dark:text-creme/70">
                      <span className="tnum">{ddmm(t.booking_date)}</span> · {txDesc(t)}
                    </span>
                    <span className="shrink-0 flex items-baseline gap-1.5">
                      {t.pontual && <Pill>pontual</Pill>}
                      <Eur cents={t.amount_cents} signed tone={t.amount_cents > 0 ? "pos" : "none"} />
                    </span>
                  </div>
                ))}
                {rows.length > PERSON_ROWS && (
                  <button className="text-xs font-medium text-petroleo" onClick={() => setAll((a) => ({ ...a, [key]: !a[key] }))}>
                    {all[key] ? "Mostrar menos" : `+ ${rows.length - PERSON_ROWS}`}
                  </button>
                )}
              </div>
              {p.devolveu > 0 && <p className={`text-xs ${muted} mt-1`}>Devolveu −{formatEuros(p.devolveu)}</p>}
            </div>
          );
        })}
      </div>
    </AreaCard>
  );
}

// ── Como saiu ───────────────────────────────────────────────────────────────

function ComoSaiu({ metodo }: { metodo: Record<Method, number> }) {
  const items = (Object.keys(metodo) as Method[]).filter((m) => metodo[m] > 0).sort((a, b) => metodo[b] - metodo[a]);
  if (items.length === 0) return null;
  return (
    <Section title="Como saiu">
      <div className="flex flex-wrap gap-2">
        {items.map((m) => (
          <span key={m} className="rounded-full border border-areia dark:border-white/10 px-3 py-1.5 text-sm">
            {METHOD_LABELS[m]} <Eur cents={metodo[m]} className="font-medium" />
          </span>
        ))}
      </div>
    </Section>
  );
}

// ── Os 10 maiores ───────────────────────────────────────────────────────────

function Maiores({ b, categoryName, reload }: { b: MonthBreakdown; categoryName: (id: string | null) => string; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (b.maiores.length === 0) return null;

  async function toggle(id: string, pontual: boolean) {
    setBusy(id);
    setErr(null);
    try {
      await setPontual(id, !pontual);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title={`Os ${b.maiores.length} maiores gastos do dia a dia`}>
      <div className="card px-4 py-1 text-sm divide-y divide-areia/60 dark:divide-white/5">
        {b.maiores.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t.desc || "—"}</span>
              <span className={`block text-xs ${muted} truncate`}>
                {ddmm(t.date)} · {categoryName(t.categoryId)}
              </span>
            </span>
            <Eur cents={t.cents} className="shrink-0 font-medium" />
            <button
              disabled={busy === t.id}
              onClick={() => void toggle(t.id, t.pontual)}
              className={`shrink-0 rounded-full border px-2 py-1 text-xs disabled:opacity-50 ${
                t.pontual ? "border-petroleo bg-petroleo/10 text-petroleo" : "border-areia dark:border-white/10 text-tinta/60 dark:text-creme/60"
              }`}
            >
              {t.pontual ? "✓ Pontual" : "Pontual"}
            </button>
          </div>
        ))}
      </div>
      {err && <p className="mt-2 text-sm text-terracota">Não consegui guardar: {err}</p>}
      <p className={`mt-1 text-xs ${muted}`}>Pontual: um gasto que não se repete (fica fora das médias e do plano).</p>
    </Section>
  );
}
