import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader, SectionTitle, EmptyState } from "@/components/ui";
import { useHousehold } from "@/data/household";
import { listIncomes, loadCredits } from "@/data/incomes";
import { loadDuetReceipts, type DuetReceiptsResult } from "@/data/duet";
import { categoriesWithRole } from "@/lib/categories";
import { incomeMonths, joanaMonths, type IncomeMonth } from "@/lib/conferir";
import { addMonth, type Credit, type ExpectedIncome } from "@/lib/forecast";
import { formatCents, formatMonth } from "@/lib/format";
import { errorMessage } from "@/lib/errors";

const MONTHS = 6;

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const todayISO = () => new Date().toISOString().slice(0, 10);
const shortMonth = (m: string) => formatMonth(m).split(" ")[0];

type Credits = (Credit & { category_id: string | null })[];

/**
 * Money in, checked month by month: what Joana marked as received in Duet
 * against what reached the Santander account as "Eventos Joana", and each
 * expected income (salary…) against what arrived.
 */
export function Conferir() {
  const navigate = useNavigate();
  const { householdId, categories } = useHousehold();
  const [credits, setCredits] = useState<Credits>([]);
  const [incomes, setIncomes] = useState<ExpectedIncome[]>([]);
  const [duet, setDuet] = useState<DuetReceiptsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(() => {
    const cur = thisMonth();
    return Array.from({ length: MONTHS }, (_, i) => addMonth(cur, i - MONTHS + 1));
  }, []);
  const from = `${months[0]}-01`;

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);
    try {
      const [cr, inc, du] = await Promise.all([
        loadCredits(householdId, from),
        listIncomes(householdId),
        loadDuetReceipts(from, todayISO()),
      ]);
      setCredits(cr);
      setIncomes(inc);
      setDuet(du);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [householdId, from]);

  useEffect(() => {
    void load();
  }, [load]);

  const eventosIds = useMemo(
    () => new Set(categoriesWithRole(categories, "eventos").map((c) => c.id)),
    [categories],
  );
  // Months before the first movement from the bank have no data to compare.
  const firstBank = credits.length ? credits[0].booking_date.slice(0, 7) : null;
  const shown = months.filter((m) => firstBank && m >= firstBank);

  const joana = useMemo(
    () =>
      joanaMonths(
        shown,
        duet?.receipts ?? [],
        credits.filter((c) => c.category_id && eventosIds.has(c.category_id)).map((c) => ({ date: c.booking_date, amount_cents: c.amount_cents })),
      ),
    [shown.join(), duet, credits, eventosIds],
  );
  const perIncome = useMemo(
    () => incomeMonths(incomes.filter((i) => i.active), credits, shown, todayISO(), credits[0]?.booking_date),
    [incomes, credits, shown.join()],
  );

  const totalGap = joana.length ? joana[joana.length - 1].runningCents : 0;

  return (
    <div className="space-y-6">
      <button className="text-sm text-tinta/50 dark:text-creme/50" onClick={() => navigate(-1)}>
        ‹ Voltar
      </button>
      <PageHeader
        title="Conferir entradas"
        subtitle="O que devia ter entrado no Santander e o que entrou, mês a mês."
      />

      {error && <p className="text-sm text-terracota">{error}</p>}

      {loading ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : shown.length === 0 ? (
        <EmptyState title="Ainda sem movimentos do banco" hint="Liga o Santander para comparar." />
      ) : (
        <>
          <section>
            <SectionTitle>Eventos da Joana</SectionTitle>
            {!duet?.configured ? (
              <p className="text-sm text-tinta/60 dark:text-creme/60">
                A app Duet não está ligada{duet?.error ? ` (${duet.error})` : ""}.
              </p>
            ) : (
              <div className="card p-4 space-y-3">
                <div
                  className={`rounded-xl px-3 py-2 text-sm ${
                    totalGap > 100 ? "bg-terracota/10 text-terracota" : totalGap < -100 ? "bg-areia/40" : "bg-petroleo/10 text-petroleo"
                  }`}
                >
                  {totalGap > 100
                    ? `Faltam ${formatCents(totalGap)} no Santander face ao que está pago na App1 (desde ${shortMonth(shown[0])}).`
                    : totalGap < -100
                      ? `Entraram mais ${formatCents(-totalGap)} no Santander do que o marcado como pago na App1 — falta marcar algum pagamento?`
                      : "Bate certo: o pago na App1 entrou todo no Santander."}
                </div>
                <table className="w-full text-sm tnum">
                  <thead className="text-xs text-tinta/50 dark:text-creme/50">
                    <tr>
                      <th className="text-left font-normal">Mês</th>
                      <th className="text-right font-normal">Pago (App1)</th>
                      <th className="text-right font-normal">No Santander</th>
                      <th className="text-right font-normal">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {joana.map((m) => (
                      <tr key={m.month} className="border-t border-areia/50 dark:border-white/5">
                        <td className="py-1.5 capitalize">{shortMonth(m.month)}</td>
                        <td className="text-right">{formatCents(m.duetCents)}</td>
                        <td className="text-right">{formatCents(m.bankCents)}</td>
                        <td className={`text-right ${m.diffCents > 100 ? "text-terracota" : ""}`}>
                          {m.diffCents === 0 ? "—" : formatCents(m.diffCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-tinta/50 dark:text-creme/50">
                  "No Santander" = entradas na categoria «{categoriesWithRole(categories, "eventos")[0]?.name ?? "Eventos Joana"}».
                  Uma transferência dela noutra categoria não conta —{" "}
                  <Link to="/regras" className="text-petroleo">cria uma regra</Link> para as apanhar.
                </p>
              </div>
            )}
          </section>

          <section>
            <SectionTitle>Entradas previstas</SectionTitle>
            {incomes.length === 0 ? (
              <p className="text-sm text-tinta/60 dark:text-creme/60">
                <Link to="/entradas-previstas" className="text-petroleo font-medium">Adiciona o ordenado e outras entradas →</Link>
              </p>
            ) : (
              <div className="space-y-3">
                {incomes.filter((i) => i.active).map((inc) => (
                  <div key={inc.id} className="card p-4">
                    <div className="font-medium text-sm mb-2">{inc.label}</div>
                    <table className="w-full text-sm tnum">
                      <tbody>
                        {(perIncome.get(inc.id) ?? []).map((m) => (
                          <IncomeRow key={m.month} m={m} />
                        ))}
                      </tbody>
                    </table>
                    <IncomeTotal rows={perIncome.get(inc.id) ?? []} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Expected vs received over the months shown (the current month only counts once it arrived). */
function IncomeTotal({ rows }: { rows: { month: string; due: boolean; expectedCents: number; receivedCents: number; missingCents: number }[] }) {
  const cur = thisMonth();
  const past = rows.filter((r) => r.due && r.month < cur);
  const missing = past.reduce((a, r) => a + r.missingCents, 0);
  const received = rows.reduce((a, r) => a + r.receivedCents, 0);
  return (
    <p className={`text-xs mt-2 ${missing > 0 ? "text-terracota" : "text-tinta/50 dark:text-creme/50"}`}>
      Recebido {formatCents(received)}
      {missing > 0 ? ` · falta ${formatCents(missing)} dos meses passados` : " · meses passados em dia"}
    </p>
  );
}

/** One month of an expected income; tap to see the transfers counted for it. */
function IncomeRow({ m }: { m: IncomeMonth }) {
  const [open, setOpen] = useState(false);
  const status = !m.due ? (
    <span className="text-tinta/40 dark:text-creme/40">não é mês</span>
  ) : m.noData ? (
    <span className="text-tinta/40 dark:text-creme/40">sem dados do banco</span>
  ) : m.missingCents === 0 ? (
    <span className="text-petroleo">✓ {formatCents(m.receivedCents)}</span>
  ) : m.month === thisMonth() ? (
    <span className="text-tinta/60 dark:text-creme/60">
      {m.receivedCents > 0 ? `${formatCents(m.receivedCents)} · ` : ""}por receber {formatCents(m.missingCents)}
    </span>
  ) : (
    <span className="text-terracota">
      {m.receivedCents > 0 ? `${formatCents(m.receivedCents)} · ` : ""}falta {formatCents(m.missingCents)}
    </span>
  );
  const canOpen = m.due && !m.noData;
  return (
    <>
      <tr
        className={`border-t first:border-t-0 border-areia/50 dark:border-white/5 ${canOpen ? "cursor-pointer" : ""}`}
        onClick={() => canOpen && setOpen((o) => !o)}
      >
        <td className="py-1.5 capitalize">{shortMonth(m.month)}</td>
        <td className="text-right">{status}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={2} className="pb-2 text-xs text-tinta/50 dark:text-creme/50">
            {m.credits.length === 0
              ? "Nenhum movimento contado — confirma a palavra-chave em Entradas previstas."
              : m.credits.map((c) => `${c.date.slice(8, 10)}/${c.date.slice(5, 7)} · ${formatCents(c.amount_cents)}`).join("  ·  ")}
          </td>
        </tr>
      )}
    </>
  );
}
