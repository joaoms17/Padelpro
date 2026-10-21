import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import { useEngineData } from "@/data/engine";
import { confirmSuggested } from "@/data/transactions";
import { TransactionSheet } from "@/components/TransactionSheet";
import { TriageGroup, ValidateGroup } from "@/components/TriageGroup";
import { Chip, Eur, Loading } from "@/components/kit";
import { EmptyState } from "@/components/ui";
import {
  INCOME_KEYS,
  inScope,
  lineLabel,
  makeClassifier,
  makeResolver,
  monthBreakdown,
  type Area,
  type EngineTx,
  type IncomeKey,
} from "@/lib/month";
import { addMonth } from "@/lib/forecast";
import { formatSigned, monthName, monthTitle } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import {
  defaultVista,
  groupByCategory,
  groupByDay,
  groupUncategorized,
  matchesSearch,
  parseVista,
  rowTitle,
  transferTargets,
  type Vista,
} from "@/lib/triage";
import { makeSuggester } from "@shared/suggest";

const SUGGESTED = new Set(["sugestao", "ai"]);

const AREA_OF: Partial<Record<Vista, Area>> = {
  entradas: "entrada",
  fixas: "fixa",
  dia: "dia",
  trabalho: "trabalho",
  voces: "voces",
  poupanca: "poupanca",
};

const LIST_CHIPS: { v: Vista; label: string }[] = [
  { v: "todos", label: "Todos" },
  { v: "entradas", label: "Entradas" },
  { v: "fixas", label: "Contas fixas" },
  { v: "dia", label: "Dia a dia" },
  { v: "trabalho", label: "Trabalho da Joana" },
  { v: "voces", label: "Para vocês" },
  { v: "poupanca", label: "Poupança" },
  { v: "pontuais", label: "Pontuais" },
];

type Notice = { tone: "ok" | "error"; text: string };

const isMonth = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const monthOf = (t: { booking_date: string }) => t.booking_date.slice(0, 7);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const weekdayFmt = new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "Hoje", "Ontem", "Quarta, 21 de outubro" (with the year when it isn't this one). */
function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Hoje";
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (iso === yesterday) return "Ontem";
  const s = weekdayFmt.format(new Date(`${iso}T00:00:00Z`)).replace("-feira", "");
  const out = s.charAt(0).toUpperCase() + s.slice(1);
  return iso.slice(0, 4) === today.slice(0, 4) ? out : `${out} de ${iso.slice(0, 4)}`;
}

function Tag({ tone = "grey", children }: { tone?: "grey" | "amber"; children: string }) {
  const cls =
    tone === "amber"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-tinta/5 text-tinta/60 dark:bg-white/10 dark:text-creme/60";
  return <span className={`shrink-0 rounded-full px-1.5 py-px text-[11px] leading-4 ${cls}`}>{children}</span>;
}

/** The place to catalogue: categorize in groups, confirm suggestions, browse. */
export function Movimentos() {
  const { householdId } = useHousehold();
  const { session } = useAuth();
  const { data, error, reload } = useEngineData(householdId);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<EngineTx | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const today = data?.ctx.today ?? "";
  const current = today.slice(0, 7);
  const first = (data?.ctx.firstDataDate ?? today).slice(0, 7);
  const mesParam = params.get("mes");
  const allMonths = mesParam === "todos";
  // No future months; an unknown value is this month.
  const mes = isMonth(mesParam) && mesParam <= current ? mesParam : current;
  const vistaParam = parseVista(params.get("vista"));
  const catParam = params.get("cat");
  const linhaParam = (INCOME_KEYS as string[]).includes(params.get("linha") ?? "") ? (params.get("linha") as IncomeKey) : null;
  const q = params.get("q") ?? "";

  const update = (patch: Record<string, string | null>, replace = false) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace },
    );
  };

  const engine = useMemo(() => {
    if (!data) return null;
    const classify = makeClassifier(data.ctx);
    const resolve = makeResolver(data.ctx.categories);
    const suggester = makeSuggester({ categories: data.allCategories, members: data.members, incomes: data.incomes });
    const counted = (t: EngineTx) => inScope(t, monthOf(t), data.ctx.today);
    const uncategorized = (t: EngineTx) => !t.category_id && t.source !== "applepay";
    const suggested = (t: EngineTx) => !!t.category_id && SUGGESTED.has(t.category_source ?? "");
    const everyMonth = data.txs.filter(counted);
    return {
      classify,
      resolve,
      suggester,
      uncategorized,
      suggested,
      totalToCategorize: everyMonth.filter(uncategorized).length,
      totalToValidate: everyMonth.filter(suggested).length,
      quick: transferTargets(data.allCategories, data.members),
    };
  }, [data]);

  const view = useMemo(() => {
    if (!data || !engine) return null;
    const rows = data.txs.filter((t) => (allMonths ? inScope(t, monthOf(t), today) : inScope(t, mes, today)));
    // Apple Pay notes the bank never booked (after 5 days they stop counting).
    const strayApplePay = data.txs.filter(
      (t) => t.source === "applepay" && (allMonths || monthOf(t) === mes) && !inScope(t, monthOf(t), today),
    ).length;
    return {
      rows,
      toCategorize: rows.filter(engine.uncategorized),
      toValidate: rows.filter(engine.suggested),
      breakdown: allMonths ? null : monthBreakdown(data.txs, data.ctx, mes),
      strayApplePay,
    };
  }, [data, engine, allMonths, mes, today]);

  const nCat = view?.toCategorize.length ?? 0;
  const nVal = view?.toValidate.length ?? 0;
  const hasFilter = !!catParam || !!linhaParam || !!q;
  const vista: Vista = vistaParam ?? defaultVista(nCat, nVal, hasFilter);

  // Keep the view the screen opened on (saving the last group shows "Tudo
  // categorizado" instead of jumping to another view).
  useEffect(() => {
    if (data && !vistaParam) update({ vista }, true);
  }, [data, vistaParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setNotice(null), [vista, mes, allMonths]);

  const triage = useMemo(() => {
    if (!view || !engine) return [];
    if (vista !== "categorizar") return [];
    return groupUncategorized(view.toCategorize, (t) => engine.suggester(t)?.category_id ?? null);
  }, [view, engine, vista]);

  const validate = useMemo(() => {
    if (!view || !engine || vista !== "validar") return [];
    return groupByCategory(view.toValidate, (id) => engine.resolve(id)?.id ?? null);
  }, [view, engine, vista]);

  const list = useMemo(() => {
    if (!view || !engine || vista === "categorizar" || vista === "validar") return [];
    const area = AREA_OF[vista];
    return view.rows.filter((t) => {
      if (vista === "pontuais" && !t.pontual) return false;
      if (area && engine.classify(t).area !== area) return false;
      if (catParam && engine.resolve(t.category_id)?.id !== catParam) return false;
      if (linhaParam) {
        const k = engine.classify(t);
        // The extra (prémio) came with the salary: show the salary movements.
        if (k.area !== "entrada" || k.key !== (linhaParam === "extra" ? "ordenado" : linhaParam)) return false;
      }
      return !q || matchesSearch(t.description_raw, q);
    });
  }, [view, engine, vista, catParam, linhaParam, q]);

  if (!data || !engine || !view || !householdId) {
    return (
      <div className="space-y-5 pb-4">
        <h1 className="text-3xl font-display pr-12">Movimentos</h1>
        <Loading error={error} />
      </div>
    );
  }

  const b = view.breakdown;
  const categoryName = (id: string) => engine.resolve(id)?.name ?? "—";
  const onDone = async (n: Notice) => {
    setNotice(n);
    await reload();
  };

  async function confirmAll() {
    if (!view) return;
    setConfirmingAll(true);
    setNotice(null);
    try {
      await confirmSuggested(view.toValidate.map((t) => t.id));
      setNotice({ tone: "ok", text: `Confirmado: ${plural(view.toValidate.length, "movimento", "movimentos")}.` });
    } catch (e) {
      setNotice({ tone: "error", text: `Não consegui confirmar: ${errorMessage(e)}` });
    } finally {
      setConfirmingAll(false);
    }
    await reload();
  }

  const chooseVista = (v: Vista) => update({ vista: v, cat: null, linha: null });
  const otherMonths = (n: number, total: number) =>
    !allMonths &&
    total > n && (
      <button className="text-sm text-petroleo" onClick={() => update({ mes: "todos" })}>
        Ver todos os meses ({total}) →
      </button>
    );
  const scopeWord = allMonths ? "" : " neste mês";

  return (
    <div className="space-y-4 pb-4">
      <h1 className="text-3xl font-display pr-12">Movimentos</h1>

      {/* Month */}
      <div className="card px-2 py-2 flex items-center justify-between gap-2">
        {allMonths ? (
          <span className="w-9" />
        ) : (
          <button
            className="w-9 h-9 shrink-0 rounded-full text-lg hover:bg-areia/50 dark:hover:bg-white/5 disabled:opacity-30"
            onClick={() => update({ mes: addMonth(mes, -1) })}
            disabled={mes <= first}
            aria-label="Mês anterior"
          >
            ‹
          </button>
        )}
        <div className="min-w-0 text-center">
          <div className="font-display">{allMonths ? "Todos os meses" : monthTitle(mes)}</div>
          {b ? (
            <div className="text-xs text-tinta/60 dark:text-creme/60">
              Entrou <Eur cents={b.entrou} /> · Saiu <Eur cents={b.casa + b.voces + b.semSaiu} />
            </div>
          ) : (
            <button className="text-xs text-petroleo" onClick={() => update({ mes: null })}>
              Voltar a {monthName(current)}
            </button>
          )}
        </div>
        {allMonths ? (
          <span className="w-9" />
        ) : (
          <button
            className="w-9 h-9 shrink-0 rounded-full text-lg hover:bg-areia/50 dark:hover:bg-white/5 disabled:opacity-30"
            onClick={() => update({ mes: addMonth(mes, 1) })}
            disabled={mes >= current}
            aria-label="Mês seguinte"
          >
            ›
          </button>
        )}
      </div>

      {/* Views */}
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
        {(nCat > 0 || vista === "categorizar") && (
          <Chip active={vista === "categorizar"} onClick={() => chooseVista("categorizar")}>
            Por categorizar ({nCat})
          </Chip>
        )}
        {(nVal > 0 || vista === "validar") && (
          <Chip active={vista === "validar"} onClick={() => chooseVista("validar")}>
            Por validar ({nVal})
          </Chip>
        )}
        {LIST_CHIPS.map((c) => (
          <Chip key={c.v} active={vista === c.v} onClick={() => chooseVista(c.v)}>
            {c.label}
          </Chip>
        ))}
      </div>

      {error && <p className="text-sm text-terracota">Não consegui atualizar: {error}</p>}
      {notice && (
        <div
          className={`flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-sm ${
            notice.tone === "ok" ? "bg-petroleo/10 text-petroleo" : "bg-terracota/10 text-terracota"
          }`}
        >
          <span className="min-w-0">{notice.text}</span>
          <button className="shrink-0" onClick={() => setNotice(null)} aria-label="Fechar">
            ✕
          </button>
        </div>
      )}

      {vista === "categorizar" && (
        <div className="space-y-3">
          <p className="text-sm text-tinta/60 dark:text-creme/60">
            Escolhe a categoria uma vez para cada grupo. Com “Aplicar também aos próximos”, os novos movimentos iguais ficam já
            categorizados.
          </p>
          {otherMonths(nCat, engine.totalToCategorize)}
          {triage.length === 0 ? (
            <EmptyState title={`Tudo categorizado${scopeWord} ✓`} />
          ) : (
            triage.map((g) => (
              <TriageGroup
                key={`${allMonths ? "todos" : mes}:${g.key}`}
                group={g}
                today={today}
                categoryName={categoryName}
                quick={engine.quick}
                householdId={householdId}
                createdBy={session?.user.id ?? null}
                onOpen={setEditing}
                onDone={onDone}
              />
            ))
          )}
        </div>
      )}

      {vista === "validar" && (
        <div className="space-y-3">
          <p className="text-sm text-tinta/60 dark:text-creme/60">A app sugeriu estas categorias. Confirma ou muda.</p>
          {otherMonths(nVal, engine.totalToValidate)}
          {validate.length === 0 ? (
            <EmptyState title={`Nada por validar${scopeWord} ✓`} />
          ) : (
            <>
              <button className="btn-primary w-full py-2.5" disabled={confirmingAll} onClick={confirmAll}>
                {confirmingAll ? "A confirmar…" : `Confirmar todas (${nVal})`}
              </button>
              {validate.map((g) => (
                <ValidateGroup
                  key={`${allMonths ? "todos" : mes}:${g.categoryId}`}
                  group={g}
                  name={categoryName(g.categoryId)}
                  today={today}
                  onOpen={setEditing}
                  onDone={onDone}
                />
              ))}
            </>
          )}
        </div>
      )}

      {vista !== "categorizar" && vista !== "validar" && (
        <div className="space-y-4">
          {(catParam || linhaParam) && (
            <div className="flex flex-wrap gap-2">
              {catParam && (
                <button
                  className="inline-flex items-center gap-1.5 rounded-full bg-tinta text-creme dark:bg-creme dark:text-tinta px-3 py-1.5 text-sm"
                  onClick={() => update({ cat: null })}
                >
                  {categoryName(catParam)} <span aria-label="Tirar filtro">✕</span>
                </button>
              )}
              {linhaParam && (
                <button
                  className="inline-flex items-center gap-1.5 rounded-full bg-tinta text-creme dark:bg-creme dark:text-tinta px-3 py-1.5 text-sm"
                  onClick={() => update({ linha: null })}
                >
                  {lineLabel(linhaParam, allMonths ? current : mes)} <span aria-label="Tirar filtro">✕</span>
                </button>
              )}
            </div>
          )}
          <input
            className="input"
            type="search"
            placeholder="Pesquisar na descrição…"
            value={q}
            onChange={(e) => update({ q: e.target.value }, true)}
          />
          {linhaParam === "extra" && (
            <p className="text-xs text-tinta/50 dark:text-creme/50">O extra veio junto com o ordenado: estes são os movimentos do ordenado.</p>
          )}
          {list.length === 0 ? (
            <EmptyState title="Sem movimentos" hint={q || hasFilter ? "Nada com estes filtros." : `Nada${scopeWord}.`} />
          ) : (
            <>
              <p className="text-xs text-tinta/50 dark:text-creme/50">
                {plural(list.length, "movimento", "movimentos")} · total{" "}
                <span className="tnum">{formatSigned(list.reduce((a, t) => a + t.amount_cents, 0))}</span>
              </p>
              {groupByDay(list.slice().reverse()).map(([day, rows]) => (
                <div key={day}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-tinta/50 dark:text-creme/50 mb-2">
                    {dayLabel(day, today)}
                  </div>
                  <div className="card divide-y divide-areia/50 dark:divide-white/5">
                    {rows.map((t) => (
                      <TxRow key={t.id} t={t} name={t.category_id ? categoryName(t.category_id) : null} onOpen={setEditing} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {view.strayApplePay > 0 && (
        <p className="text-xs text-tinta/50 dark:text-creme/50">
          {view.strayApplePay === 1
            ? "1 nota do Apple Pay sem par no banco (não conta)."
            : `${view.strayApplePay} notas do Apple Pay sem par no banco (não contam).`}
        </p>
      )}

      <TransactionSheet tx={editing} onClose={() => setEditing(null)} onSaved={reload} members={data.members} />
    </div>
  );
}

function TxRow({ t, name, onOpen }: { t: EngineTx & { merchant_clean?: string | null }; name: string | null; onOpen: (t: EngineTx) => void }) {
  const credit = t.amount_cents > 0;
  return (
    <button
      onClick={() => onOpen(t)}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-areia/30 dark:active:bg-white/5"
    >
      <div className="min-w-0">
        <div className="font-medium truncate">{t.merchant_clean || rowTitle(t.description_raw) || "Movimento"}</div>
        <div className="flex items-center gap-1.5 min-w-0 text-xs text-tinta/50 dark:text-creme/50">
          {name ? <span className="truncate">{name}</span> : <span className="truncate text-terracota font-medium">Por categorizar</span>}
          {name && SUGGESTED.has(t.category_source ?? "") && <Tag tone="amber">sugestão</Tag>}
          {t.pontual && <Tag>pontual</Tag>}
          {t.source === "applepay" && <Tag tone="amber">Apple Pay pendente</Tag>}
        </div>
      </div>
      <div className={`tnum shrink-0 ${credit ? "text-petroleo" : ""}`}>{formatSigned(t.amount_cents)}</div>
    </button>
  );
}
