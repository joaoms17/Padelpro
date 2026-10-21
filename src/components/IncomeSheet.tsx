// Add, change or remove something that comes in regularly (ordenado,
// despesas de representação, renda…). Used by the Plano ("O que entra
// todos os meses").
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { createIncome, deleteIncome, updateIncome, type IncomeInput } from "@/data/incomes";
import { addMonth, matchingCredits, monthDiff, nextDueMonth, type Credit, type IncomeSuggestion } from "@/lib/forecast";
import { incomeKind, type IncomeKind } from "@/lib/month";
import { formatCents, formatMonth, parseCents } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { KIND_LABELS } from "@/lib/planView";

export const FREQ: { every: number; label: string }[] = [
  { every: 1, label: "Todos os meses" },
  { every: 2, label: "De 2 em 2 meses" },
  { every: 3, label: "De 3 em 3 meses" },
  { every: 6, label: "De 6 em 6 meses" },
  { every: 12, label: "Uma vez por ano" },
];

const KINDS: IncomeKind[] = ["salario", "representacao", "renda", "outra"];

export type IncomeDraft = IncomeInput & { id?: string };

export const newIncomeDraft = (month: string): IncomeDraft => ({
  label: "",
  amount_cents: 0,
  parts: 1,
  day: 1,
  every_months: 1,
  anchor_month: `${month}-01`,
  match_text: "",
  kind: null,
});

export const draftFromSuggestion = (s: IncomeSuggestion): IncomeDraft => ({
  label: s.label,
  amount_cents: s.amount_cents,
  parts: s.parts,
  day: s.day,
  every_months: s.every_months,
  anchor_month: s.anchor_month,
  match_text: s.match_text,
  kind: null,
});

/** "1 951,57 €" or "1 000,00 € (2 × 500,00 €)". */
export function amountText(i: { amount_cents: number; parts: number }) {
  return i.parts > 1
    ? `${formatCents(i.amount_cents)} (${i.parts} × ${formatCents(Math.round(i.amount_cents / i.parts))})`
    : formatCents(i.amount_cents);
}

export function IncomeSheet({
  draft,
  householdId,
  credits,
  month,
  onClose,
  onSaved,
}: {
  draft: IncomeDraft | null;
  householdId: string;
  /** Recent money in, to show which movements the keyword finds. */
  credits: Credit[];
  /** The current month (YYYY-MM). */
  month: string;
  onClose: () => void;
  /** After a change: reload the screen's data. */
  onSaved: () => Promise<void> | void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<IncomeKind>("outra");
  const [kindTouched, setKindTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [parts, setParts] = useState(1);
  const [day, setDay] = useState("1");
  const [every, setEvery] = useState(1);
  const [next, setNext] = useState(month);
  const [keyword, setKeyword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setLabel(draft.label);
    setKind(draft.kind ?? (draft.label ? incomeKind({ label: draft.label, kind: null }) : "outra"));
    setKindTouched(!!draft.kind);
    setAmount(draft.amount_cents ? (draft.amount_cents / 100).toFixed(2).replace(".", ",") : "");
    setParts(draft.parts);
    setDay(String(draft.day));
    setEvery(draft.every_months);
    setNext(nextDueMonth({ active: true, anchor_month: draft.anchor_month, every_months: draft.every_months }, month));
    setKeyword(draft.match_text ?? "");
    setConfirmDelete(false);
    setError(null);
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

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () => {
    const input: IncomeInput = {
      label,
      kind,
      amount_cents: amountCents,
      parts,
      day: dayN,
      every_months: every,
      anchor_month: `${next}-01`,
      match_text: keyword,
    };
    return run(() => (draft.id ? updateIncome(draft.id, input) : createIncome(householdId, input)));
  };

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
            onChange={(e) => {
              setLabel(e.target.value);
              if (!kindTouched) setKind(incomeKind({ label: e.target.value, kind: null }));
            }}
          />
        </div>
        <div>
          <span className="label">Tipo</span>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setKindTouched(true);
                }}
                className={`rounded-2xl border px-3 py-2 text-sm text-left ${
                  kind === k
                    ? "bg-tinta text-creme border-tinta dark:bg-creme dark:text-tinta dark:border-creme"
                    : "border-areia dark:border-white/10 text-tinta/70 dark:text-creme/70"
                }`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
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
            <select id="inc-parts" className="input appearance-none" value={parts} onChange={(e) => setParts(Number(e.target.value))}>
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

        <button className="btn-primary w-full" disabled={busy || !valid} onClick={save}>
          {busy ? "A guardar…" : "Guardar"}
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
                onClick={() => run(() => deleteIncome(draft.id!))}
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
