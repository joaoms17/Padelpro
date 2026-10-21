// The plan: what comes in, what the house costs, what to save, and so how
// much each mesada can be. One formula on top, fed by six short steps, and
// the next six months under the plan.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useHousehold } from "@/data/household";
import { useEngineData, type EngineData } from "@/data/engine";
import { putPlanInPlace, savePlan, setBudgets } from "@/data/plan";
import { lastDayOf, loadDuetEvents, loadDuetReceipts, type DuetReceipt } from "@/data/duet";
import { useJoanaWaivers } from "@/data/incomes";
import { BudgetTable, EuroInput } from "@/components/BudgetTable";
import { IncomeSheet, draftFromSuggestion, newIncomeDraft, amountText, type IncomeDraft } from "@/components/IncomeSheet";
import { Chip, Eur, Loading, Pill, Row, Section } from "@/components/kit";
import { buildMonthsView } from "@/lib/view";
import { joanaHistory, monthlyEq, planTotals, projection, type ExtrasRule, type PlanSettings } from "@/lib/plan";
import { incomeKind, JOANA_FROM } from "@/lib/month";
import { addMonth, suggestIncomes } from "@/lib/forecast";
import { formatCents, formatEuros, monthDay, monthName } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { nextStamp } from "@/lib/sequence";
import { applyPatch, isEmptyPatch, mergePatch, planDiff, unappliedChanges, type PlanPatch } from "@/lib/planPatch";
import {
  KIND_LABELS,
  applyBudgets,
  budgetRows,
  casaArrendada,
  commonMesada,
  coveredMean,
  currentMonthRest,
  duetByMonth,
  duetHistory,
  eventsByMonth,
  folgaRisk,
  freqText,
  incomeCredits,
  joanaForMonth,
  joanaRows,
  mesadaChecklist,
  monthsList,
  monthsOfHouse,
  monthsText,
  peopleAverages,
  projMonthLabel,
  realityCheck,
  seedFromMeans,
  setAllMesadas,
  startLabel,
  stepsDone,
  suggestionCredits,
  withDefaults,
} from "@/lib/planView";

const muted = "text-tinta/60 dark:text-creme/60";
const faint = "text-tinta/50 dark:text-creme/50";

const EXTRAS: { value: ExtrasRule; label: string }[] = [
  { value: "poupanca", label: "Tudo para a poupança" },
  { value: "metade", label: "Metade para a poupança, metade para os dois" },
  { value: "decidir", label: "Decidimos cada vez" },
];

const STEPS = [
  { id: "entradas", short: "Entradas" },
  { id: "joana", short: "Joana" },
  { id: "fixas", short: "Contas fixas" },
  { id: "dia-a-dia", short: "Dia a dia" },
  { id: "poupanca", short: "Poupança" },
  { id: "mesadas", short: "Mesadas" },
] as const;

const DAY_MS = 86400000;
const daysBefore = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function go(id: string, behavior: ScrollBehavior = "smooth") {
  document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
}

function Header({ plan, current, pending = false }: { plan: PlanSettings | null; current: string | null; pending?: boolean }) {
  return (
    <header className="pr-12 space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-3xl font-display">Plano</h1>
        {plan &&
          (plan.active ? (
            <Pill tone="green">
              Em vigor {current && current >= plan.start_month ? "desde" : "a partir de"} {startLabel(plan.start_month)}
            </Pill>
          ) : (
            <Pill>Rascunho</Pill>
          ))}
        {pending && (
          <button onClick={() => go("mesadas")} className="active:opacity-60">
            <Pill tone="amber">Alterações por aplicar</Pill>
          </button>
        )}
      </div>
      <p className={`${muted} leading-relaxed`}>Quanto entra, quanto custa a casa e quanto pode ser a mesada de cada um.</p>
    </header>
  );
}

/** The plan: what comes in, what the house costs, the mesadas it allows. */
export function Plano() {
  const { householdId } = useHousehold();
  const { data, error, reload } = useEngineData(householdId);
  if (!data || !householdId) {
    return (
      <div className="space-y-5">
        <Header plan={null} current={null} />
        <Loading error={error} />
      </div>
    );
  }
  return <PlanoScreen data={data} householdId={householdId} reload={reload} />;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; error: string };

/** Every write goes through here: one "A guardar… / Guardado" indicator, errors shown. */
function useSaveStatus() {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const pending = useRef(0);
  const hide = useRef<number | undefined>();
  const track = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    pending.current++;
    window.clearTimeout(hide.current);
    setState({ kind: "saving" });
    try {
      await fn();
      pending.current--;
      if (pending.current === 0) {
        setState({ kind: "saved" });
        hide.current = window.setTimeout(() => setState((s) => (s.kind === "saved" ? { kind: "idle" } : s)), 2000);
      }
      return true;
    } catch (e) {
      pending.current--;
      setState({ kind: "error", error: errorMessage(e) });
      return false;
    }
  }, []);
  const dismiss = useCallback(() => setState({ kind: "idle" }), []);
  return { state, track, dismiss };
}

function SaveToast({ state, onDismiss }: { state: SaveState; onDismiss: () => void }) {
  if (state.kind === "idle") return null;
  const cls =
    state.kind === "error"
      ? "bg-terracota text-creme"
      : state.kind === "saved"
        ? "bg-petroleo text-creme"
        : "bg-tinta/80 text-creme dark:bg-creme/90 dark:text-tinta";
  return (
    <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 pointer-events-none" role="status" aria-live="polite">
      <div className={`pointer-events-auto max-w-sm rounded-full px-4 py-2 text-sm shadow-card flex items-center gap-3 ${cls}`}>
        <span className="min-w-0">
          {state.kind === "saving" ? "A guardar…" : state.kind === "saved" ? "Guardado ✓" : `Não consegui guardar: ${state.error}`}
        </span>
        {state.kind === "error" && (
          <button onClick={onDismiss} aria-label="Fechar" className="shrink-0">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function Step({ id, n, title, done, children }: { id: string; n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-16">
      <Section
        title={
          <>
            {n}. {title}
            {done && <span className="ml-1.5 text-petroleo">✓</span>}
          </>
        }
      >
        {children}
      </Section>
    </div>
  );
}

function PlanoScreen({ data, householdId, reload }: { data: EngineData; householdId: string; reload: () => Promise<void> }) {
  const { hash } = useLocation();
  const view = useMemo(() => buildMonthsView(data), [data]);
  const members = data.members;
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const today = data.ctx.today;
  const current = view.current;
  const status = useSaveStatus();
  const { track } = status;

  // ── The plan: the server's copy plus the changes made here ────────────────
  // Only what changed here is saved (on top of the server's plan), so the
  // other phone's changes stay. Every plan write goes through `chain`, one
  // after the other, "Pôr o plano em vigor" included.
  const membersRef = useRef(members);
  membersRef.current = members;
  const fill = useCallback((p: PlanSettings) => withDefaults(p, membersRef.current), []);
  /** The plan as the server last had it. */
  const server = useRef<PlanSettings>(data.plan);
  /** Changes being saved. */
  const sending = useRef<PlanPatch>({});
  /** Changes not sent yet. */
  const edits = useRef<PlanPatch>({});
  /** Loads stamped before this did not see our last plan write. */
  const writtenAt = useRef(0);
  const shown = useCallback(
    () => fill(applyPatch(applyPatch(server.current, sending.current), edits.current)),
    [fill],
  );
  const [plan, setPlanState] = useState<PlanSettings>(shown);
  const latest = useRef(plan);
  const timer = useRef<number | undefined>();
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(() => {
    const p = shown();
    latest.current = p;
    setPlanState(p);
  }, [shown]);

  // A reload (or the other person's change) shows up under what is still being typed;
  // a load that started before our last write is older than what we have.
  useEffect(() => {
    if (data.stamp < writtenAt.current) return;
    server.current = data.plan;
    refresh();
  }, [data, refresh]);

  /** Run a plan write after the ones before it. */
  const onChain = useCallback((job: () => Promise<boolean>) => {
    const run = chain.current.then(job);
    chain.current = run;
    return run;
  }, []);

  /** After a plan write: the plan as the server has it now, then a reload. */
  const written = useCallback(
    async (saved: PlanSettings) => {
      server.current = saved;
      writtenAt.current = nextStamp();
      refresh();
      await reload();
    },
    [refresh, reload],
  );

  const flush = useCallback((): Promise<unknown> => {
    window.clearTimeout(timer.current);
    if (isEmptyPatch(edits.current)) return chain.current;
    return onChain(async () => {
      // Whatever was typed until now goes in this write.
      const patch = edits.current;
      if (isEmptyPatch(patch)) return true;
      edits.current = {};
      sending.current = patch;
      return track(async () => {
        let saved: PlanSettings;
        try {
          saved = await savePlan(householdId, patch, fill);
        } catch (e) {
          // Kept for the next try (with the next change, or on leaving).
          edits.current = mergePatch(patch, edits.current);
          sending.current = {};
          refresh();
          throw e;
        }
        sending.current = {};
        await written(saved);
      });
    });
  }, [fill, householdId, onChain, track, written]);

  const updatePlan = useCallback(
    (f: (p: PlanSettings) => PlanSettings, now = false) => {
      const prev = latest.current;
      const next = f(prev);
      edits.current = mergePatch(edits.current, planDiff(prev, next));
      latest.current = next;
      setPlanState(next);
      window.clearTimeout(timer.current);
      if (now) void flush();
      else timer.current = window.setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  // Leaving the screen: save what is pending.
  useEffect(() => () => void (!isEmptyPatch(edits.current) && flush()), [flush]);

  // ── Limits: shown at once, saved on blur ───────────────────────────────────
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  useEffect(() => {
    // Forget the on-screen values the server already has.
    setOverrides((prev) => {
      const server = new Map(data.allCategories.map((c) => [c.id, c.budget_cents && c.budget_cents > 0 ? c.budget_cents : null]));
      const next = Object.fromEntries(Object.entries(prev).filter(([id, v]) => server.get(id) !== v));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [data.allCategories]);

  // One limit write after the other: a limit typed while "Usar as médias" is
  // still saving is written after it, so it is the one that stays.
  const budgetChain = useRef<Promise<unknown>>(Promise.resolve());
  const saveBudgets = useCallback(
    (values: Record<string, number | null>) => {
      const norm = Object.fromEntries(Object.entries(values).map(([id, v]) => [id, v && v > 0 ? Math.round(v) : null]));
      if (Object.keys(norm).length === 0) return;
      setOverrides((prev) => ({ ...prev, ...norm }));
      budgetChain.current = budgetChain.current.then(() =>
        track(async () => {
          try {
            await setBudgets(norm);
          } catch (e) {
            // Back to the server's value, unless it was typed again since.
            setOverrides((prev) => {
              const next = { ...prev };
              for (const [id, v] of Object.entries(norm)) if (next[id] === v) delete next[id];
              return next;
            });
            await reload();
            throw e;
          }
          await reload();
        }),
      );
    },
    [reload, track],
  );

  const categories = useMemo(
    () => applyBudgets(data.allCategories.filter((c) => !c.archived), overrides),
    [data.allCategories, overrides],
  );
  // ── Joana: everything she receives on Duet goes to the account ───────────
  // So her part is not a value to set: the plan counts on her Duet average
  // over the last 12 complete months (this month's receipts so far are for
  // the rest of it). undefined: loading; null: Duet not set up.
  const duetFirst = addMonth(current, -12);
  const [duetRes, setDuetRes] = useState<DuetReceipt[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadDuetReceipts(`${duetFirst}-01`, today).then((r) => {
      if (alive) setDuetRes(r.configured ? r.receipts : null);
    });
    return () => {
      alive = false;
    };
  }, [duetFirst, today]);
  const duet = useMemo(() => (duetRes ? duetHistory(duetRes, current) : null), [duetRes, current]);
  const duetNow = duetRes ? (duetByMonth(duetRes)[current] ?? 0) : null;
  const joana = useMemo(
    () => joanaHistory(view.closed.map((m) => view.real.get(m)!), duet, current),
    [view, duet, current],
  );
  const joanaTable = useMemo(() => joanaRows(joana, duet, view.closed, duetFirst), [joana, duet, view, duetFirst]);
  const weakestMonth = joanaTable.find((r) => r.weakest)?.month ?? null;
  const { waivers } = useJoanaWaivers(householdId);
  // The coming months: what is already booked on Duet (the events' values).
  const [booked, setBooked] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    void loadDuetEvents(`${addMonth(current, 1)}-01`, lastDayOf(addMonth(current, 6))).then((r) => {
      if (alive) setBooked(r.configured ? eventsByMonth(r.events) : {});
    });
    return () => {
      alive = false;
    };
  }, [current]);

  const totals = useMemo(
    () => planTotals(data.incomes, categories, plan, memberIds, joana.average ?? 0),
    [data.incomes, categories, plan, memberIds, joana.average],
  );
  const steps = useMemo(
    () => stepsDone(data.incomes, categories, plan, memberIds, joana.average),
    [data.incomes, categories, plan, memberIds, joana.average],
  );

  // ── What the steps show ────────────────────────────────────────────────────
  // The last two closed months as columns (the average may cover more).
  const tableMonths = useMemo(() => view.closed.slice(-2), [view]);
  const fixaRows = useMemo(() => budgetRows(categories, "fixa", tableMonths, view.semPontuais, view.averages), [categories, tableMonths, view]);
  const diaRows = useMemo(() => budgetRows(categories, "variavel", tableMonths, view.semPontuais, view.averages), [categories, tableMonths, view]);
  const atividadeRows = useMemo(() => budgetRows(categories, "atividade", tableMonths, view.semPontuais, view.averages), [categories, tableMonths, view]);
  const arrendada = useMemo(() => casaArrendada(categories, data.incomes, view.averages), [categories, data.incomes, view]);
  const covers = plan.mesada_covers.filter((id) => diaRows.some((r) => r.id === id));
  const coverNames = covers.map((id) => diaRows.find((r) => r.id === id)!.name);
  const reality = realityCheck(view.averages, totals, covers);
  const casaPlano = totals.F + totals.V + totals.A;
  const runway = monthsOfHouse(data.balanceCents, casaPlano);

  const credits = useMemo(() => incomeCredits(data.txs, data.ctx, daysBefore(today, 150)), [data.txs, data.ctx, today]);
  const suggestions = useMemo(
    () => suggestIncomes(suggestionCredits(credits, data.incomes), data.incomes, today),
    [credits, data.incomes, today],
  );
  const [editing, setEditing] = useState<IncomeDraft | null>(null);

  // The next months start from where this one ends, as Este mês forecasts it;
  // the rest of this month is the first row.
  const rest = useMemo(
    () =>
      currentMonthRest({
        balance: data.balanceCents ?? 0,
        real: view.real.get(current)!,
        sem: view.semPontuais.get(current)!,
        categories,
        plan,
        incomes: data.incomes,
        members,
        mesadaMonths: data.mesadaMonths,
        txs: data.txs,
        today,
        casa: casaPlano,
        joanaDuet: duetNow,
        joanaWaived: waivers?.[current] ?? 0,
      }),
    [data, view, current, categories, plan, members, today, casaPlano, duetNow, waivers],
  );
  // Joana in each coming month: what is already booked on Duet, or her average.
  const proj = useMemo(
    () => [rest, ...projection(current, 6, rest.saldoFim, data.incomes, totals, plan, memberIds, joanaForMonth(booked, totals.J))],
    [rest, current, data.incomes, totals, plan, memberIds, booked],
  );
  const firstLow = proj.find((p) => p.baixo);

  // Mesadas: one value for both, or one each.
  const common = commonMesada(plan, memberIds);
  const [separate, setSeparate] = useState(() => common === null);
  const [dayText, setDayText] = useState(String(plan.mesada_day));
  useEffect(() => setDayText(String(plan.mesada_day)), [plan.mesada_day]);
  const transitionMonths: string[] = [];
  for (let m = JOANA_FROM; m < plan.start_month && transitionMonths.length < 12; m = addMonth(m, 1)) {
    if (m >= current) transitionMonths.push(m);
  }
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  // With the plan active: what was changed but is not applied yet.
  const unapplied = useMemo(
    () => unappliedChanges(plan, members, data.mesadaMonths, current),
    [plan, members, data.mesadaMonths, current],
  );
  const pendingApply = plan.active && !activating && unapplied.length > 0;

  // On the plan's chain: the changes typed before go first, and the ones typed
  // while it runs are saved after it (on top of what it saved).
  async function activate() {
    setActivating(true);
    void flush();
    const ok = await onChain(() =>
      track(async () => {
        await written(await putPlanInPlace(householdId, latest.current, members, fill));
      }),
    );
    setActivating(false);
    if (ok) setActivated(true);
  }

  // Links like /plano#mesadas: the steps only exist once the data is here.
  useEffect(() => {
    if (hash) requestAnimationFrame(() => go(decodeURIComponent(hash.slice(1)), "auto"));
  }, [hash]);

  // A slim summary on top once the decision card scrolls away.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHidden, setCardHidden] = useState(false);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCardHidden(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const folgaText = (cents: number) => (cents >= 0 ? `Folga: +${formatEuros(cents)}/mês` : `O plano não fecha: faltam ${formatEuros(-cents)}/mês`);

  return (
    <div className="space-y-8">
      {cardHidden && (
        <button
          onClick={() => go("decisao")}
          className="fixed inset-x-0 top-0 z-30 bg-creme/95 dark:bg-tinta/95 backdrop-blur border-b border-areia/70 dark:border-white/10"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="max-w-xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-left">
              {steps.ready && totals.D > 0 ? (
                <>
                  Mesada possível: até <Eur cents={totals.mesadaPossivel} className="font-semibold" /> cada
                </>
              ) : (
                <>
                  Para as mesadas <Eur cents={totals.D} className="font-semibold" />
                </>
              )}
            </span>
            {totals.mesadasTotal > 0 && (
              <span className={`shrink-0 tnum ${totals.folga >= 0 ? "text-petroleo" : "text-terracota"}`}>
                {totals.folga >= 0 ? `Folga +${formatEuros(totals.folga)}` : `Faltam ${formatEuros(-totals.folga)}`}
              </span>
            )}
          </div>
        </button>
      )}

      <Header plan={plan} current={current} pending={pendingApply} />

      {/* ── A. The decision ──────────────────────────────────────────────── */}
      <div ref={cardRef} id="decisao" className="card p-5 space-y-4 scroll-mt-16">
        <div>
          <Row label="Entra todos os meses" right={<Eur cents={totals.R} />} onClick={() => go("entradas")} />
          <Row
            label="+ Joana (média na Duet)"
            sub={duetRes === undefined ? "a ver a Duet…" : joana.average == null ? "sem dados da Duet" : undefined}
            right={<Eur cents={totals.J} />}
            onClick={() => go("joana")}
          />
          <Row label="− Contas fixas" right={<Eur cents={totals.F} />} onClick={() => go("fixas")} />
          <Row
            label="− Dia a dia"
            sub={coverNames.length ? `sem ${coverNames.join(", ")} (passa para a mesada)` : undefined}
            right={<Eur cents={totals.V} />}
            onClick={() => go("dia-a-dia")}
          />
          <Row label="− Trabalho da Joana" right={<Eur cents={totals.A} />} onClick={() => go("dia-a-dia")} />
          <Row label="− Poupança" right={<Eur cents={totals.P} />} onClick={() => go("poupanca")} />
          <div className="mt-1 pt-1 border-t border-areia dark:border-white/10">
            <Row strong label="= Para as mesadas" right={<Eur cents={totals.D} tone={totals.D < 0 ? "neg" : "none"} />} />
          </div>
        </div>

        {!steps.ready ? (
          <p className="rounded-2xl bg-areia/50 dark:bg-white/5 px-3 py-2 text-sm">Preenche os passos 1 a 4 para ver a mesada possível.</p>
        ) : totals.D > 0 ? (
          <p className="font-display text-xl leading-snug">
            Mesada possível: até <Eur cents={totals.mesadaPossivel} className="text-petroleo" /> cada
          </p>
        ) : (
          <p className="font-medium text-terracota">Não sobra nada para as mesadas: faltam {formatEuros(-totals.D)}/mês.</p>
        )}

        <div className="space-y-2">
          {!separate ? (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="mesada-comum" className="text-sm font-medium">
                Mesada combinada
              </label>
              <div className="flex items-center gap-2">
                <div className="w-28">
                  <EuroInput
                    id="mesada-comum"
                    value={Object.keys(plan.mesadas).length ? common : null}
                    onChange={(v) => updatePlan((p) => setAllMesadas(p, memberIds, v ?? 0))}
                    onCommit={() => void flush()}
                  />
                </div>
                <span className={`text-sm ${muted}`}>cada</span>
              </div>
            </div>
          ) : (
            members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3">
                <label htmlFor={`mesada-a-${m.id}`} className="text-sm font-medium">
                  Mesada {m.display_name}
                </label>
                <div className="w-28">
                  <EuroInput
                    id={`mesada-a-${m.id}`}
                    value={plan.mesadas[m.id] ?? null}
                    onChange={(v) => updatePlan((p) => ({ ...p, mesadas: { ...p.mesadas, [m.id]: v ?? 0 } }))}
                    onCommit={() => void flush()}
                  />
                </div>
              </div>
            ))
          )}
          <button
            className="text-xs text-petroleo"
            onClick={() => {
              if (separate) updatePlan((p) => setAllMesadas(p, memberIds, p.mesadas[memberIds[0]] ?? 0), true);
              setSeparate(!separate);
            }}
          >
            {separate ? "o mesmo valor para os dois" : "valores diferentes"}
          </button>
        </div>

        {totals.mesadasTotal > 0 && (
          <div className="space-y-1">
            <p className={`font-medium ${totals.folga >= 0 ? "text-petroleo" : "text-terracota"}`}>{folgaText(totals.folga)}</p>
            {totals.J > 0 && joana.weakest != null && joana.weakest < totals.J && (
              <p className={`text-sm ${muted}`}>
                Num mês fraco da Joana ({formatEuros(joana.weakest)}): {folgaRisk(totals.folga - (totals.J - joana.weakest))}.
              </p>
            )}
            {totals.J > 0 && <p className={`text-sm ${muted}`}>Num mês sem eventos: {folgaRisk(totals.folgaSemJoana)}.</p>}
          </div>
        )}

        {reality && (
          <div className="pt-3 border-t border-areia/60 dark:border-white/10 space-y-1.5 text-sm">
            {(steps.fixas || steps.dia) && (
              <p className={reality.ok ? "text-petroleo" : "text-amber-700 dark:text-amber-300"}>
                Em {monthsList(reality.months)} a casa custou em média {formatEuros(reality.casaMedia)}
                {covers.length > 0 && " (sem o que passa para a mesada)"}; o plano conta com {formatEuros(reality.casaPlano)}.
                {view.averages.provisorio && " (meses ainda com movimentos sem categoria)"}
              </p>
            )}
            <p className={muted}>
              Em {monthsList(reality.months)} {peopleAverages(members, view.averages.pessoas)}.
              {view.averages.provisorio && " (meses ainda com movimentos sem categoria)"}
            </p>
          </div>
        )}
      </div>

      {/* ── B. The steps ─────────────────────────────────────────────────── */}
      <nav className="-mx-4 px-4 flex gap-2 overflow-x-auto pb-1" aria-label="Passos">
        {STEPS.map((s, i) => {
          const done = [steps.entradas, steps.joana, steps.fixas, steps.dia, steps.poupanca, steps.mesadas][i];
          return (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                done ? "border-petroleo/40 text-petroleo" : "border-areia dark:border-white/10 text-tinta/70 dark:text-creme/70"
              }`}
            >
              {i + 1}. {s.short}
              {done && " ✓"}
            </button>
          );
        })}
      </nav>

      {/* 1. Incomes */}
      <Step id="entradas" n={1} title="O que entra todos os meses" done={steps.entradas}>
        {data.incomes.length === 0 ? (
          <p className={`card p-4 text-sm ${muted}`}>
            Ainda nada. Adiciona o ordenado, as despesas de representação e a renda{suggestions.length > 0 && " — ou escolhe abaixo o que encontrei no banco"}.
          </p>
        ) : (
          <div className="card divide-y divide-areia/50 dark:divide-white/5">
            {data.incomes.map((i) => (
              <button
                key={i.id}
                className={`w-full text-left px-4 py-3 flex items-start justify-between gap-3 active:opacity-60 ${i.active ? "" : "opacity-50"}`}
                onClick={() => setEditing({ ...i })}
              >
                <span className="min-w-0">
                  <span className="block font-medium truncate">{i.label}</span>
                  <span className={`block text-xs ${faint}`}>
                    {KIND_LABELS[incomeKind(i)]} · {freqText(i.every_months)} · dia {i.day}
                    {i.parts > 1 && ` · em ${i.parts} transferências`}
                    {!i.active && " · desligada"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm tnum">{formatCents(i.amount_cents)}</span>
                  {i.every_months > 1 && <span className={`block text-xs tnum ${faint}`}>= {formatEuros(monthlyEq(i))}/mês</span>}
                </span>
              </button>
            ))}
            <div className="px-4 py-2.5 flex items-center justify-between text-sm font-semibold">
              <span>Por mês</span>
              <Eur cents={totals.R} />
            </div>
          </div>
        )}
        <button className="btn-ghost w-full mt-3" onClick={() => setEditing(newIncomeDraft(current))}>
          + Adicionar
        </button>
        <p className={`mt-2 text-xs ${faint}`}>Prémios e subsídios não entram aqui: aparecem como extra quando chegam.</p>
        {suggestions.length > 0 && (
          <div className="mt-4">
            <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${faint}`}>Encontrei no banco</h3>
            <div className="card divide-y divide-areia/50 dark:divide-white/5">
              {suggestions.map((s) => (
                <div key={`${s.match_text}:${s.amount_cents}`} className="px-4 py-3 flex items-center justify-between gap-3">
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium truncate">«{s.match_text}»</span>
                    <span className={`block text-xs ${faint}`}>
                      {amountText(s)} · por volta do dia {s.day} · {freqText(s.every_months)} · visto em {s.months} meses
                    </span>
                  </span>
                  <button className="text-sm text-petroleo font-medium shrink-0" onClick={() => setEditing(draftFromSuggestion(s))}>
                    Adicionar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Step>

      {/* 2. Joana */}
      <Step id="joana" n={2} title="Joana" done={steps.joana}>
        <div className="card p-4 space-y-3">
          <p className="font-medium">A Joana põe na conta tudo o que recebe na Duet.</p>
          {duetRes === undefined ? (
            <p className={`text-sm ${faint}`}>A ver a Duet…</p>
          ) : duetRes === null ? (
            <p className={`text-sm ${muted}`}>Sem dados da Duet: o plano conta com 0 € da Joana.</p>
          ) : joana.average == null ? (
            <p className={`text-sm ${muted}`}>Nada recebido na Duet nos últimos 12 meses: o plano conta com 0 € da Joana.</p>
          ) : (
            <p className="text-sm">
              Média <Eur cents={joana.average} className="font-semibold" />
              /mês
              {joana.weakest != null && weakestMonth && (
                <>
                  {" "}
                  · mês mais fraco <Eur cents={joana.weakest} /> ({monthName(weakestMonth)})
                </>
              )}
              <span className={muted}>
                {" "}
                · {joana.count} {joana.count === 1 ? "mês" : "meses"}
              </span>
            </p>
          )}
          {joanaTable.length > 0 && (
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className={`text-[11px] ${faint}`}>
                  <th className="pb-1 text-left font-medium">Mês</th>
                  <th className="pb-1 text-right font-medium">Duet recebido</th>
                  <th className="pb-1 text-right font-medium">Chegou à conta</th>
                </tr>
              </thead>
              <tbody>
                {joanaTable.map((r) => (
                  <tr key={r.month} className="border-t border-areia/50 dark:border-white/5">
                    <td className="py-1.5">
                      {capital(monthName(r.month))}
                      {r.weakest && <span className={faint}> · mais fraco</span>}
                    </td>
                    <td className="py-1.5 text-right tnum">{r.duet == null ? "—" : formatEuros(r.duet)}</td>
                    <td className="py-1.5 text-right tnum">{r.bank == null ? "—" : formatEuros(r.bank)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {joanaTable.some((r) => r.month < JOANA_FROM && r.bank != null) && (
            <p className={`text-xs ${faint}`}>Antes de novembro a Joana ainda não passava tudo para a conta — não é dívida.</p>
          )}
          {joana.average != null && (
            <p className={`text-xs ${muted}`}>Meses acima da média reforçam a poupança; meses abaixo são cobertos por ela.</p>
          )}
          <Link to="/meses/joana" className="block text-sm font-medium text-petroleo dark:text-teal-300 active:opacity-60">
            Ver o histórico completo →
          </Link>
        </div>
      </Step>

      {/* 3. Contas fixas */}
      <Step id="fixas" n={3} title="Contas fixas" done={steps.fixas}>
        <div className="card p-3">
          <BudgetTable
            rows={fixaRows}
            months={tableMonths}
            averageMonths={view.averages.months}
            limitLabel="Previsto"
            onCommit={(id, v) => saveBudgets({ [id]: v })}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="btn-ghost shrink-0 px-4 py-2 text-sm"
            disabled={!fixaRows.some((r) => r.mean > 0)}
            onClick={() => saveBudgets(seedFromMeans(fixaRows))}
          >
            Usar as médias
          </button>
          <span className={`min-w-0 text-xs ${faint}`}>Previsto: o que cada conta custa num mês normal.</span>
        </div>
        {arrendada && (
          <p className={`mt-3 text-sm ${muted}`}>
            Casa arrendada: renda {formatEuros(arrendada.renda)} − prestação {formatEuros(arrendada.prestacao)} ={" "}
            <Eur cents={arrendada.net} tone="auto" signed />
            /mês
          </p>
        )}
      </Step>

      {/* 4. Dia a dia */}
      <Step id="dia-a-dia" n={4} title="Dia a dia" done={steps.dia}>
        {view.averages.provisorio && (
          <p className="mb-3 rounded-2xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            Ainda há movimentos sem categoria em {monthsList(view.averages.months, true)} — as médias podem estar baixas.{" "}
            <Link to="/movimentos?vista=categorizar" className="font-medium underline">
              Categorizar →
            </Link>
          </p>
        )}
        <div className="card p-3">
          <BudgetTable
            rows={diaRows}
            extraRows={atividadeRows}
            months={tableMonths}
            averageMonths={view.averages.months}
            limitLabel="Limite"
            covered={covers}
            onCommit={(id, v) => saveBudgets({ [id]: v })}
          />
        </div>
        <div className="mt-3">
          <button
            className="btn-ghost px-4 py-2 text-sm"
            disabled={![...diaRows, ...atividadeRows].some((r) => r.mean > 0)}
            onClick={() => saveBudgets(seedFromMeans([...diaRows.filter((r) => !covers.includes(r.id)), ...atividadeRows]))}
          >
            Usar as médias (arredondadas a 10 €)
          </button>
        </div>
        <div className="mt-4 card p-4 space-y-2">
          <p className="text-sm font-medium">Passa para a mesada</p>
          <p className={`text-xs ${faint}`}>
            O que cada um passa a pagar da sua mesada. Sai do dia a dia (o limite deixa de contar).
          </p>
          <div className="flex flex-wrap gap-2">
            {diaRows.map((r) => (
              <Chip
                key={r.id}
                active={covers.includes(r.id)}
                onClick={() =>
                  updatePlan(
                    (p) => ({
                      ...p,
                      mesada_covers: p.mesada_covers.includes(r.id) ? p.mesada_covers.filter((x) => x !== r.id) : [...p.mesada_covers, r.id],
                    }),
                    true,
                  )
                }
              >
                {covers.includes(r.id) ? "✓ " : ""}
                {r.name}
              </Chip>
            ))}
          </div>
        </div>
      </Step>

      {/* 5. Poupança e extras */}
      <Step id="poupanca" n={5} title="Poupança e extras" done={steps.poupanca}>
        <div className="card p-4 space-y-4">
          <div>
            <label className="label" htmlFor="poupar">
              Quanto querem poupar por mês
            </label>
            <EuroInput
              id="poupar"
              value={plan.savings_cents > 0 ? plan.savings_cents : null}
              onChange={(v) => updatePlan((p) => ({ ...p, savings_cents: v ?? 0 }))}
              onCommit={() => void flush()}
            />
          </div>
          {runway != null && (
            <p className="text-sm">
              Hoje o saldo da conta ({formatEuros(data.balanceCents ?? 0)}) dá para <strong>{monthsText(runway)}</strong> de casa.
            </p>
          )}
          <fieldset>
            <legend className="label">Os extras (prémios, subsídios) vão:</legend>
            {EXTRAS.map((o) => (
              <label key={o.value} className="flex items-center gap-3 py-1.5">
                <input
                  type="radio"
                  name="extras"
                  className="h-4 w-4 shrink-0 accent-petroleo"
                  checked={plan.extras_rule === o.value}
                  onChange={() => updatePlan((p) => ({ ...p, extras_rule: o.value }), true)}
                />
                <span className="text-sm">{o.label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </Step>

      {/* 6. Mesadas */}
      <Step id="mesadas" n={6} title="Mesadas" done={steps.mesadas}>
        <div className="card p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">A partir de {monthDay(plan.start_month, "first")}</p>
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3">
                <label htmlFor={`mesada-${m.id}`} className="text-sm">
                  {m.display_name}
                </label>
                <div className="w-28">
                  <EuroInput
                    id={`mesada-${m.id}`}
                    value={plan.mesadas[m.id] ?? null}
                    onChange={(v) => {
                      if (!separate && memberIds.length > 1) setSeparate(true);
                      updatePlan((p) => ({ ...p, mesadas: { ...p.mesadas, [m.id]: v ?? 0 } }));
                    }}
                    onCommit={() => void flush()}
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="mesada-dia" className="text-sm">
                Dia da transferência
              </label>
              <input
                id="mesada-dia"
                className="input w-20 text-right tnum"
                inputMode="numeric"
                value={dayText}
                onChange={(e) => {
                  const t = e.target.value.replace(/\D/g, "").slice(0, 2);
                  setDayText(t);
                  const d = Number(t);
                  if (d >= 1 && d <= 28) updatePlan((p) => ({ ...p, mesada_day: d }));
                }}
                onBlur={() => {
                  setDayText(String(latest.current.mesada_day));
                  void flush();
                }}
              />
            </div>
          </div>

          {transitionMonths.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-areia/60 dark:border-white/10">
              <p className="text-sm font-medium">
                {capital(transitionMonths.map((m) => monthName(m)).join(", "))} (transição)
              </p>
              <p className={`text-xs ${faint}`}>O plano ainda não está em vigor: cada um fica com isto.</p>
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3">
                  <label htmlFor={`transicao-${m.id}`} className="text-sm">
                    {m.display_name}
                  </label>
                  <div className="w-28">
                    <EuroInput
                      id={`transicao-${m.id}`}
                      value={plan.transition[m.id] ?? 0}
                      onChange={(v) => updatePlan((p) => ({ ...p, transition: { ...p.transition, [m.id]: v ?? 0 } }))}
                      onCommit={() => void flush()}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {coverNames.length > 0 && (
            <p className={`text-sm ${muted}`}>
              A mesada passa a pagar: {coverNames.join(", ")} (média {formatEuros(coveredMean(view.averages, covers))}/mês).
            </p>
          )}

          {totals.mesadasTotal > 0 && totals.folga < 0 && (
            <p className="text-sm text-terracota">Atenção: com estas mesadas o plano não fecha (faltam {formatEuros(-totals.folga)}/mês).</p>
          )}

          {pendingApply && (
            <div className="rounded-2xl bg-amber-500/10 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Alterações por aplicar</p>
              <ul className="space-y-1.5 text-sm">
                {unapplied.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="text-amber-700 dark:text-amber-300">•</span>
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
              <p className={`text-xs ${muted}`}>
                Até carregares em «Atualizar o plano», Este mês e os avisos continuam com os valores antigos.
              </p>
            </div>
          )}

          <button
            className={`${plan.active && !pendingApply ? "btn-ghost" : "btn-primary"} w-full`}
            disabled={activating || totals.mesadasTotal === 0}
            onClick={() => void activate()}
          >
            {activating ? "A guardar…" : plan.active ? "Atualizar o plano" : `Pôr o plano em vigor a ${monthDay(plan.start_month, "first")}`}
          </button>
          {totals.mesadasTotal === 0 && <p className={`text-xs ${faint}`}>Escolhe primeiro as mesadas (no topo ou aqui).</p>}

          {plan.active && !pendingApply && (
            <div className="rounded-2xl bg-petroleo/10 p-3 space-y-2">
              <p className="text-sm font-medium text-petroleo">
                {activated ? "Plano em vigor ✓" : "Em vigor"} · no banco, até {monthDay(plan.start_month, "first")}:
              </p>
              <ul className="space-y-1.5 text-sm">
                {mesadaChecklist(plan, members).map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="text-petroleo">○</span>
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
              <p className={`text-xs ${muted}`}>O que cada um tirar além da mesada aparece como «além da mesada».</p>
            </div>
          )}
        </div>
      </Step>

      {/* ── C. The next six months ──────────────────────────────────────── */}
      <Section title="Próximos 6 meses">
        {!steps.entradas ? (
          <p className={`card p-4 text-sm ${muted}`}>Preenche o que entra todos os meses para ver os próximos meses.</p>
        ) : (
          <div className="card p-3">
            <p className={`mb-2 text-xs ${faint}`}>
              {data.balanceCents != null
                ? `A partir do saldo de hoje (${formatEuros(data.balanceCents)}) e do que ainda falta entrar e sair em ${monthName(current)}.`
                : `Sem saldo do banco ainda: começa em 0 € (mais o que ainda falta entrar e sair em ${monthName(current)}).`}
            </p>
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[17%]" />
                <col />
                <col />
                <col />
                <col className="w-[24%]" />
              </colgroup>
              <thead>
                <tr className={`text-[11px] ${faint}`}>
                  <th className="pb-1 text-left font-medium">Mês</th>
                  <th className="pb-1 text-right font-medium">Entra</th>
                  <th className="pb-1 text-right font-medium">Sai</th>
                  <th className="pb-1 text-right font-medium">Sobra</th>
                  <th className="pb-1 text-right font-medium">Saldo no fim</th>
                </tr>
              </thead>
              <tbody>
                {proj.map((p, i) => (
                  <tr
                    key={p.month}
                    className={`border-t border-areia/50 dark:border-white/5 ${p.baixo ? "bg-amber-500/10 text-amber-800 dark:text-amber-200" : ""}`}
                  >
                    <td className="py-1.5 pl-1 leading-tight">
                      {projMonthLabel(p.month)}
                      {i === 0 && <span className={`block text-[10px] ${faint}`}>o resto</span>}
                    </td>
                    <td className="py-1.5 text-right tnum">{formatEuros(p.entra)}</td>
                    <td className="py-1.5 text-right tnum">{formatEuros(p.sai)}</td>
                    <td className="py-1.5 text-right tnum">
                      <Eur cents={p.sobra} signed tone={p.baixo ? "none" : p.sobra < 0 ? "neg" : "none"} />
                    </td>
                    <td className="py-1.5 pr-1 text-right tnum font-medium">
                      <Eur cents={p.saldoFim} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {firstLow && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                Em {monthName(firstLow.month)} o saldo fica abaixo de um mês de casa.
              </p>
            )}
            <p className={`mt-2 text-[11px] ${faint}`}>
              {capital(monthName(current))}: só o que ainda falta até {monthDay(current, "last")}, como na previsão de Este mês. Depois, entra: o
              que entra todos os meses e a Joana (a partir de novembro). Sai: contas fixas, dia a dia, trabalho
              da Joana e mesadas{transitionMonths.length > 0 && ` (em ${monthName(transitionMonths[0])} as da transição)`}. A poupança fica no
              saldo; os extras não contam.
            </p>
            <p className={`mt-1 text-[11px] ${faint}`}>
              {duetRes === null ? "Joana: sem dados da Duet (conta 0 €)." : "Joana: o que já está marcado na Duet, ou a média."}
            </p>
          </div>
        )}
      </Section>

      <IncomeSheet
        draft={editing}
        householdId={householdId}
        credits={credits}
        month={current}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
      <SaveToast state={status.state} onDismiss={status.dismiss} />
    </div>
  );
}
