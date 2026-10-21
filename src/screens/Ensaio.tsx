import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { useHousehold } from "@/data/household";
import { loadRecentTx } from "@/data/budget";
import { listIncomes, loadCredits } from "@/data/incomes";
import { loadDuetReceipts } from "@/data/duet";
import { loadMembers } from "@/data/settings";
import { incomeMonths } from "@/lib/conferir";
import { ensaio, type EnsaioMonth } from "@/lib/ensaio";
import { addMonth } from "@/lib/forecast";
import { formatCents, formatMonth } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import type { Member } from "@/lib/types";

const todayISO = () => new Date().toISOString().slice(0, 10);
const shortMonth = (m: string) => formatMonth(m).split(" ")[0];

/**
 * "Ensaio das mesadas": how each month would have closed if every income had
 * come into the Santander account and only the agreed mesadas had gone out —
 * to size the mesadas before the real start in December.
 */
export function Ensaio() {
  const { householdId, categories, contaCasa } = useHousehold();
  const [rows, setRows] = useState<EnsaioMonth[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId || categories.length === 0) return;
    setError(null);
    try {
      const today = todayISO();
      const [tx, incomes, credits, mem] = await Promise.all([
        loadRecentTx(householdId, 190),
        listIncomes(householdId),
        loadCredits(householdId, new Date(Date.now() - 190 * 86400000).toISOString().slice(0, 10)),
        loadMembers(householdId),
      ]);
      const house = tx.filter((t) => !contaCasa || !t.account_id || t.account_id === contaCasa.id);
      if (house.length === 0) {
        setRows([]);
        return;
      }
      const dataFrom = house.map((t) => t.booking_date).sort()[0];
      const months: string[] = [];
      for (let m = dataFrom.slice(0, 7); m <= today.slice(0, 7); m = addMonth(m, 1)) months.push(m);
      const group = new Map(categories.map((c) => [c.id, c.grp]));
      const notInternal = credits.filter((c) => !c.category_id || group.get(c.category_id) !== "interna");
      const active = incomes.filter((i) => i.active);
      const perIncome = incomeMonths(active, notInternal, months, today, dataFrom);
      const duet = await loadDuetReceipts(`${months[0]}-01`, today);
      setMembers(mem);
      setRows(
        ensaio({
          months,
          dataFrom,
          today,
          tx: house,
          group,
          incomeRows: active.map((i) => perIncome.get(i.id) ?? []),
          joanaReceipts: duet.receipts,
          mesadasCents: mem.reduce((a, m) => a + (m.mesada_cents || 0), 0),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [householdId, categories, contaCasa]);

  useEffect(() => {
    void load();
  }, [load]);

  const full = (rows ?? []).filter((r) => !r.partial);
  const avg = full.length ? Math.round(full.reduce((a, r) => a + r.sobraCents, 0) / full.length) : null;
  const total = (rows ?? []).reduce((a, r) => a + r.sobraCents, 0);
  const people = members.filter((m) => m.mesada_cents > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ensaio das mesadas"
        subtitle="Como teria sido cada mês se todo o dinheiro entrasse no Santander e só saíssem as despesas da casa e as mesadas."
      />

      {error && <p className="text-sm text-terracota">{error}</p>}

      {rows == null ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A calcular…</div>
      ) : rows.length === 0 ? (
        <EmptyState title="Ainda sem movimentos do banco" />
      ) : (
        <>
          <Card className="bg-petroleo/5 border-petroleo/20">
            <div className="text-sm text-tinta/60 dark:text-creme/60">
              Sobra média por mês {full.length ? `(${full.length} ${full.length === 1 ? "mês completo" : "meses completos"})` : ""}
            </div>
            <div className={`text-4xl font-display tnum ${avg != null && avg < 0 ? "text-terracota" : "text-petroleo"}`}>
              {avg == null ? "—" : formatCents(avg)}
            </div>
            <p className="text-sm text-tinta/60 dark:text-creme/60 mt-1">
              Desde {shortMonth(rows[0].month)}: {formatCents(total)} no total.
            </p>
            <div className="mt-3 text-sm space-y-1">
              <div className="text-tinta/60 dark:text-creme/60">
                Mesadas definidas:{" "}
                {people.length
                  ? people.map((m) => `${m.display_name} ${formatCents(m.mesada_cents)}`).join(" · ")
                  : "nenhuma"}{" "}
                · <Link to="/dinheiro" className="text-petroleo">mudar</Link>
              </div>
              {avg != null && people.length > 0 && (
                <div className={avg < 0 ? "text-terracota" : ""}>
                  {avg >= 0
                    ? `Com esta média, cada mesada podia subir até +${formatCents(Math.floor(avg / people.length))} e o mês ainda fechava a zero.`
                    : `Com esta média, cada mesada teria de baixar ${formatCents(Math.ceil(-avg / people.length))} para o mês fechar a zero.`}
                </div>
              )}
            </div>
          </Card>

          <div className="card p-4">
            <table className="w-full table-fixed text-sm tnum">
              <thead className="text-xs text-tinta/50 dark:text-creme/50">
                <tr>
                  <th className="text-left font-normal w-[28%]">Mês</th>
                  <th className="text-right font-normal">Entra</th>
                  <th className="text-right font-normal">Sai</th>
                  <th className="text-right font-normal">Sobra</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.month} r={r} />
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-tinta/50 dark:text-creme/50 leading-relaxed">
              Entra = as tuas entradas previstas (o que entrou, ou o previsto se não entrou) + o que a Joana marcou como
              recebido na App1. Sai = despesas da casa (fixas, variáveis, atividade) + as mesadas definidas. As retiradas
              e transferências reais ficam de fora — no ensaio são substituídas pela mesada. Toca num mês para ver as contas.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ r }: { r: EnsaioMonth }) {
  const [open, setOpen] = useState(false);
  const entra = r.joaoCents + r.joanaCents;
  const sai = r.despesasCents + r.mesadasCents;
  const line = (label: string, cents: number, sign = "", muted = false) => (
    <div className={`flex justify-between gap-3 ${muted ? "text-tinta/40 dark:text-creme/40" : ""}`}>
      <span className="truncate min-w-0">{label}</span>
      <span className="shrink-0">{sign}{formatCents(cents)}</span>
    </div>
  );
  return (
      <>
        <tr className="border-t border-areia/50 dark:border-white/5 cursor-pointer" onClick={() => setOpen((o) => !o)}>
          <td className="py-1.5 capitalize">
            {shortMonth(r.month)}
            {r.partial && <span className="text-tinta/40 dark:text-creme/40">*</span>} {open ? "▾" : "▸"}
          </td>
          <td className="text-right">{formatCents(entra)}</td>
          <td className="text-right text-terracota">−{formatCents(sai)}</td>
          <td className={`text-right font-medium ${r.sobraCents < 0 ? "text-terracota" : "text-petroleo"}`}>
            {formatCents(r.sobraCents)}
          </td>
        </tr>
        {open && (
          <tr>
            <td colSpan={4} className="pb-3 text-xs text-tinta/60 dark:text-creme/60 space-y-0.5">
              {r.partial && <div className="text-tinta/40 dark:text-creme/40">* mês com dados parciais</div>}
              {line("+ Entradas do João", r.joaoCents)}
              {line("+ Recebido pela Joana (App1)", r.joanaCents)}
              {line("− Despesas da casa", r.despesasCents)}
              {line("− Mesadas definidas", r.mesadasCents)}
              {line("Fora do ensaio: retiradas e transferências reais", r.retiradasCents, "", true)}
              {r.semCategoriaCents > 0 && (
                <div className="text-terracota">
                  {formatCents(r.semCategoriaCents)} de saídas sem categoria não contam —{" "}
                  <Link to="/por-rever" className="underline">categoriza-as</Link>.
                </div>
              )}
            </td>
          </tr>
        )}
      </>
  );
}
