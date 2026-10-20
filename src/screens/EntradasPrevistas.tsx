import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, EmptyState, SectionTitle } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { useHousehold } from "@/data/household";
import {
  createIncome,
  deleteIncome,
  listIncomes,
  loadCredits,
  updateIncome,
  type IncomeInput,
} from "@/data/incomes";
import {
  addMonth,
  incomeStatus,
  isDueInMonth,
  matchingCredits,
  monthDiff,
  nextDueMonth,
  suggestIncomes,
  type Credit,
  type ExpectedIncome,
  type IncomeSuggestion,
} from "@/lib/forecast";
import { formatCents, formatMonth, parseCents } from "@/lib/format";
import { errorMessage } from "@/lib/errors";

const FREQ: { every: number; label: string }[] = [
  { every: 1, label: "Todos os meses" },
  { every: 2, label: "De 2 em 2 meses" },
  { every: 3, label: "De 3 em 3 meses" },
  { every: 6, label: "De 6 em 6 meses" },
  { every: 12, label: "Uma vez por ano" },
];
const freqLabel = (every: number) => FREQ.find((f) => f.every === every)?.label ?? `De ${every} em ${every} meses`;

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function amountText(i: Pick<ExpectedIncome, "amount_cents" | "parts">) {
  return i.parts > 1
    ? `${formatCents(i.amount_cents)} (${i.parts} × ${formatCents(Math.round(i.amount_cents / i.parts))})`
    : formatCents(i.amount_cents);
}

type Draft = IncomeInput & { id?: string };

export function EntradasPrevistas() {
  const navigate = useNavigate();
  const { householdId, categoriesById } = useHousehold();
  const [incomes, setIncomes] = useState<ExpectedIncome[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const month = thisMonth();

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const [inc, cr] = await Promise.all([listIncomes(householdId), loadCredits(householdId, daysAgo(150))]);
      setIncomes(inc);
      // Transfers between their own accounts are not income.
      setCredits(cr.filter((c) => !c.category_id || categoriesById.get(c.category_id)?.grp !== "interna"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [householdId, categoriesById]);

  useEffect(() => {
    void load();
  }, [load]);

  const statuses = useMemo(
    () => new Map(incomeStatus(incomes, credits, month, todayISO()).map((s) => [s.income.id, s])),
    [incomes, credits, month],
  );
  const suggestions = useMemo(() => suggestIncomes(credits, incomes, todayISO()), [credits, incomes]);

  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function edit(d: Draft | null) {
    setError(null);
    setEditing(d);
  }

  const fromSuggestion = (s: IncomeSuggestion): Draft => ({
    label: s.label,
    amount_cents: s.amount_cents,
    parts: s.parts,
    day: s.day,
    every_months: s.every_months,
    anchor_month: s.anchor_month,
    match_text: s.match_text,
  });

  return (
    <div className="space-y-5">
      <button className="text-sm text-tinta/50 dark:text-creme/50" onClick={() => navigate(-1)}>
        ‹ Voltar
      </button>
      <PageHeader
        title="Entradas previstas"
        subtitle="O que costuma entrar na conta e quando. Conta na previsão do fim do mês até o movimento chegar."
      />

      {error && !editing && <p className="text-sm text-terracota">{error}</p>}

      {loading ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : incomes.length === 0 ? (
        <EmptyState
          title="Ainda nada"
          hint="Adiciona o ordenado, as despesas de representação, a renda… ou escolhe uma sugestão abaixo."
        />
      ) : (
        <div className="card divide-y divide-areia/50 dark:divide-white/5">
          {incomes.map((i) => {
            const st = statuses.get(i.id);
            const due = isDueInMonth(i, month);
            return (
              <button
                key={i.id}
                className="w-full text-left px-4 py-3 flex items-start justify-between gap-3"
                onClick={() => edit({ ...i })}
              >
                <span className="min-w-0">
                  <span className="block font-medium truncate">{i.label}</span>
                  <span className="block text-xs text-tinta/50 dark:text-creme/50">
                    {amountText(i)} · dia {i.day} · {freqLabel(i.every_months).toLowerCase()}
                    {i.match_text ? ` · «${i.match_text}»` : " · sem palavra-chave"}
                  </span>
                </span>
                <span className="text-xs shrink-0 text-right">
                  {!due ? (
                    <span className="text-tinta/50 dark:text-creme/50">
                      próxima: {formatMonth(nextDueMonth(i, month)).split(" ")[0]}
                    </span>
                  ) : st && st.pendingCents === 0 ? (
                    <span className="text-petroleo">✓ já entrou</span>
                  ) : (
                    <span className="text-terracota">
                      falta {formatCents(st?.pendingCents ?? i.amount_cents)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        className="btn-primary w-full"
        onClick={() =>
          edit({ label: "", amount_cents: 0, parts: 1, day: 1, every_months: 1, anchor_month: `${month}-01`, match_text: "" })
        }
      >
        + Nova entrada prevista
      </button>

      {!loading && suggestions.length > 0 && (
        <section>
          <SectionTitle>Encontrei no banco</SectionTitle>
          <div className="card divide-y divide-areia/50 dark:divide-white/5">
            {suggestions.map((s) => (
              <div key={`${s.match_text}:${s.amount_cents}`} className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium truncate">«{s.match_text}»</span>
                  <span className="block text-xs text-tinta/50 dark:text-creme/50">
                    {amountText(s)} · por volta do dia {s.day} · {freqLabel(s.every_months).toLowerCase()} · visto em {s.months} meses
                  </span>
                </span>
                <button className="text-sm text-petroleo font-medium shrink-0" onClick={() => edit(fromSuggestion(s))}>
                  Adicionar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <EditIncome
        draft={editing}
        credits={credits}
        busy={busy}
        error={error}
        onClose={() => edit(null)}
        onSave={(d) =>
          run(() => (d.id ? updateIncome(d.id, d) : createIncome(householdId!, d)))
        }
        onDelete={(id) => run(() => deleteIncome(id))}
      />
    </div>
  );
}

function EditIncome({
  draft,
  credits,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft | null;
  credits: Credit[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (d: Draft) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const month = thisMonth();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [parts, setParts] = useState(1);
  const [day, setDay] = useState("1");
  const [every, setEvery] = useState(1);
  const [next, setNext] = useState(month);
  const [keyword, setKeyword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setLabel(draft.label);
    setAmount(draft.amount_cents ? (draft.amount_cents / 100).toFixed(2).replace(".", ",") : "");
    setParts(draft.parts);
    setDay(String(draft.day));
    setEvery(draft.every_months);
    setNext(nextDueMonth({ active: true, anchor_month: draft.anchor_month, every_months: draft.every_months }, month));
    setKeyword(draft.match_text ?? "");
    setConfirmDelete(false);
  }, [draft, month]);

  const amountCents = parseCents(amount) ?? 0;
  const dayN = Number(day);
  const valid = !!label.trim() && amountCents > 0 && dayN >= 1 && dayN <= 31;
  const matches = useMemo(
    () => (keyword.trim() && amountCents > 0 ? matchingCredits(keyword, amountCents / parts, dayN, credits) : []),
    [keyword, amountCents, parts, dayN, credits],
  );

  if (!draft) return null;
  // Months the next one can be in, given the frequency.
  const nextOptions = Array.from({ length: every }, (_, i) => addMonth(month, i));

  return (
    <Sheet open={!!draft} onClose={onClose} title={draft.id ? "Entrada prevista" : "Nova entrada prevista"}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="inc-label">Nome</label>
          <input
            id="inc-label"
            className="input"
            placeholder="Ex: Ordenado João"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inc-amount">Valor no mês (€)</label>
            <input
              id="inc-amount"
              className="input tnum"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="inc-parts">Em</label>
            <select
              id="inc-parts"
              className="input appearance-none"
              value={parts}
              onChange={(e) => setParts(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 transferência" : `${n} transferências`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inc-day">Dia do mês</label>
            <input
              id="inc-day"
              className="input tnum"
              inputMode="numeric"
              value={day}
              onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
            />
          </div>
          <div>
            <label className="label" htmlFor="inc-every">Frequência</label>
            <select
              id="inc-every"
              className="input appearance-none"
              value={every}
              onChange={(e) => {
                const ev = Number(e.target.value);
                setEvery(ev);
                if (monthDiff(month, next) >= ev) setNext(month);
              }}
            >
              {FREQ.map((f) => (
                <option key={f.every} value={f.every}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {every > 1 && (
          <div>
            <label className="label" htmlFor="inc-next">Próxima vez</label>
            <select id="inc-next" className="input appearance-none" value={next} onChange={(e) => setNext(e.target.value)}>
              {nextOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="inc-kw">Palavra-chave na descrição do banco</label>
          <input
            id="inc-kw"
            className="input"
            placeholder="Ex: ntt data"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <p className="text-xs text-tinta/50 dark:text-creme/50 mt-1">
            {!keyword.trim()
              ? "Sem palavra-chave, a app assume que entrou depois do dia indicado."
              : matches.length === 0
                ? "Nenhum movimento dos últimos meses com esta palavra e um valor parecido."
                : `Últimos: ${matches
                    .slice(0, 3)
                    .map((c) => `${formatCents(c.amount_cents)} a ${c.booking_date.slice(8, 10)}/${c.booking_date.slice(5, 7)}`)
                    .join(" · ")}`}
          </p>
        </div>

        <button
          className="btn-primary w-full"
          disabled={busy || !valid}
          onClick={async () => {
            const ok = await onSave({
              id: draft.id,
              label,
              amount_cents: amountCents,
              parts,
              day: dayN,
              every_months: every,
              anchor_month: `${next}-01`,
              match_text: keyword,
            });
            if (ok) onClose();
          }}
        >
          Guardar
        </button>

        {error && <p className="text-sm text-terracota">{error}</p>}

        {draft.id && (
          <div className="pt-2 border-t border-areia/50 dark:border-white/5">
            {!confirmDelete ? (
              <button className="text-sm text-terracota" onClick={() => setConfirmDelete(true)}>
                Apagar…
              </button>
            ) : (
              <button
                className="btn-ghost w-full text-terracota"
                disabled={busy}
                onClick={async () => {
                  if (await onDelete(draft.id!)) onClose();
                }}
              >
                Confirmar: apagar esta entrada prevista
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
