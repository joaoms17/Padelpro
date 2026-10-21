import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Card, EmptyState, SectionTitle } from "@/components/ui";
import { useHousehold } from "@/data/household";
import { loadRecentTx } from "@/data/budget";
import { listIncomes, loadCredits } from "@/data/incomes";
import { loadDuetReceipts } from "@/data/duet";
import { loadMembers } from "@/data/settings";
import { loadMesadaMonths, setMesadaMonth, type MesadaMonth } from "@/data/mesadas";
import { incomeMonths, type IncomeMonth } from "@/lib/conferir";
import { ensaio, fullMonths, sustainableMesada, withMesada, type EnsaioMonth } from "@/lib/ensaio";
import { isOverride, mesadaFor, takenByMember } from "@/lib/mesadas";
import { addMonth } from "@/lib/forecast";
import { formatCents, formatMonth, parseCents } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import type { Member } from "@/lib/types";

const todayISO = () => new Date().toISOString().slice(0, 10);
const shortMonth = (m: string) => formatMonth(m).split(" ")[0];
/** Whole euros in the narrow table (cents in the details). */
const euros = (cents: number) => `${Math.round(cents / 100).toLocaleString("pt-PT")} €`;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

interface Base {
  months: string[];
  dataFrom: string;
  tx: Awaited<ReturnType<typeof loadRecentTx>>;
  incomeRows: IncomeMonth[][];
  joanaReceipts: { date: string; amount_cents: number }[];
}

/**
 * Mesadas: each month as if every income had come into the Santander account
 * and only the house spending and the mesadas had gone out — with the
 * mesada of each person set month by month, what each one really took, a
 * simulator and the highest mesada the months can carry.
 */
export function MesadasModulo() {
  const { householdId, categories, contaCasa } = useHousehold();
  const [base, setBase] = useState<Base | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [overrides, setOverrides] = useState<MesadaMonth[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState("");

  const load = useCallback(async () => {
    if (!householdId || categories.length === 0) return;
    setError(null);
    try {
      const today = todayISO();
      const since = new Date(Date.now() - 190 * 86400000).toISOString().slice(0, 10);
      const [tx, incomes, credits, mem, ov] = await Promise.all([
        loadRecentTx(householdId, 190),
        listIncomes(householdId),
        loadCredits(householdId, since),
        loadMembers(householdId),
        loadMesadaMonths(householdId),
      ]);
      const house = tx.filter((t) => !contaCasa || !t.account_id || t.account_id === contaCasa.id);
      setMembers(mem);
      setOverrides(ov);
      if (house.length === 0) {
        setEmpty(true);
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
      setBase({
        months,
        dataFrom,
        tx: house,
        incomeRows: active.map((i) => perIncome.get(i.id) ?? []),
        joanaReceipts: duet.receipts,
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [householdId, categories, contaCasa]);

  useEffect(() => {
    void load();
  }, [load]);

  const group = useMemo(() => new Map(categories.map((c) => [c.id, c.grp])), [categories]);
  const rows = useMemo(
    () =>
      base &&
      ensaio({
        ...base,
        today: todayISO(),
        group,
        mesadasFor: (month) => members.reduce((a, m) => a + mesadaFor(m, month, overrides), 0),
      }),
    [base, group, members, overrides],
  );
  const taken = useMemo(
    () => (base ? takenByMember(base.tx, categories, members) : new Map<string, Map<string, number>>()),
    [base, categories, members],
  );

  const people = Math.max(1, members.length);
  const full = rows ? fullMonths(rows) : [];
  const avgSobra = avg(full.map((r) => r.sobraCents));
  const sustainable = rows ? sustainableMesada(rows, people) : null;
  const testCents = parseCents(test);
  const simulated = rows && testCents != null ? fullMonths(withMesada(rows, testCents, people)) : null;

  async function saveMonth(memberId: string, month: string, cents: number | null) {
    if (!householdId) return;
    try {
      await setMesadaMonth(householdId, memberId, month, cents);
      setOverrides(await loadMesadaMonths(householdId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mesadas"
        subtitle="Cada mês como se todo o dinheiro entrasse no Santander e só saíssem as despesas da casa e as mesadas."
      />

      {error && <p className="text-sm text-terracota">{error}</p>}

      {empty ? (
        <EmptyState title="Ainda sem movimentos do banco" />
      ) : !rows ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A calcular…</div>
      ) : (
        <>
          <Card className="bg-petroleo/5 border-petroleo/20">
            <div className="text-sm text-tinta/60 dark:text-creme/60">
              Mesada sustentável por pessoa
              {full.length ? ` (média de ${full.length} ${full.length === 1 ? "mês completo" : "meses completos"})` : ""}
            </div>
            <div className="text-4xl font-display tnum text-petroleo">
              {sustainable == null ? "—" : formatCents(Math.max(0, sustainable))}
            </div>
            <p className="text-sm text-tinta/60 dark:text-creme/60 mt-1">
              O máximo para cada um com que o mês médio fechava a zero.
            </p>
            <div className="mt-3 text-sm">
              Com as mesadas definidas, sobra em média{" "}
              <b className={`tnum ${avgSobra != null && avgSobra < 0 ? "text-terracota" : ""}`}>
                {avgSobra == null ? "—" : formatCents(avgSobra)}
              </b>{" "}
              por mês.
            </div>
            <div className="mt-1 text-xs text-tinta/50 dark:text-creme/50">
              Valor base: {members.map((m) => `${m.display_name} ${formatCents(m.mesada_cents || 0)}`).join(" · ")} ·{" "}
              <Link to="/dinheiro" className="text-petroleo">mudar</Link>
            </div>
          </Card>

          <Card>
            <div className="text-sm text-tinta/60 dark:text-creme/60">Contas reais desde {rows.length ? shortMonth(rows[0].month) : ""}</div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-tinta/50 dark:text-creme/50 text-xs">Pago a vocês (mesadas e retiradas)</div>
                <div className="text-xl font-display tnum">{formatCents(rows.reduce((a, r) => a + r.retiradasCents, 0))}</div>
              </div>
              <div>
                <div className="text-tinta/50 dark:text-creme/50 text-xs">Podia ter pago mais</div>
                <div className={`text-xl font-display tnum ${rows.reduce((a, r) => a + r.podiaMaisCents, 0) < 0 ? "text-terracota" : "text-petroleo"}`}>
                  {formatCents(rows.reduce((a, r) => a + r.podiaMaisCents, 0))}
                </div>
              </div>
            </div>
            {full.length > 0 && (
              <p className="mt-2 text-xs text-tinta/50 dark:text-creme/50">
                Em média, nos meses completos: pago {formatCents(avg(full.map((r) => r.retiradasCents)) ?? 0)} e podia mais{" "}
                {formatCents(avg(full.map((r) => r.podiaMaisCents)) ?? 0)} por mês — a dividir por {people}.
              </p>
            )}
          </Card>

          <section>
            <SectionTitle>Simulador</SectionTitle>
            <Card>
              <label className="label" htmlFor="sim">E se cada um tivesse de mesada…</label>
              <div className="flex gap-2 items-center">
                <input
                  id="sim"
                  className="input tnum w-32"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={test}
                  onChange={(e) => setTest(e.target.value)}
                />
                <span className="text-sm text-tinta/60 dark:text-creme/60">€ por mês</span>
              </div>
              {simulated && simulated.length > 0 && (
                <div className="mt-3 text-sm space-y-1">
                  <div>
                    Sobra média:{" "}
                    <b className={`tnum ${(avg(simulated.map((r) => r.sobraCents)) ?? 0) < 0 ? "text-terracota" : "text-petroleo"}`}>
                      {formatCents(avg(simulated.map((r) => r.sobraCents)) ?? 0)}
                    </b>
                  </div>
                  <div className="text-tinta/60 dark:text-creme/60">
                    {simulated.filter((r) => r.sobraCents < 0).length} de {simulated.length} meses completos ficavam negativos.
                  </div>
                </div>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle>Mês a mês</SectionTitle>
            <div className="card p-4">
              <table className="w-full table-fixed text-sm tnum">
                <thead className="text-xs text-tinta/50 dark:text-creme/50">
                  <tr>
                    <th className="text-left font-normal w-[22%]">Mês</th>
                    <th className="text-right font-normal">Entra</th>
                    <th className="text-right font-normal">Despesas</th>
                    <th className="text-right font-normal">Pago a vocês</th>
                    <th className="text-right font-normal">Podia mais</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <MonthRow
                      key={r.month}
                      r={r}
                      members={members}
                      overrides={overrides}
                      taken={taken}
                      onSave={saveMonth}
                    />
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-tinta/50 dark:text-creme/50 leading-relaxed">
                Entra = as tuas entradas previstas no valor normal (ordenado, despesas, renda — sem prémios nem subsídios) +
                o que a Joana marcou como recebido na App1. Despesas = tudo o que saiu para a casa (prestações, fixas,
                variáveis, atividade). Pago a vocês = mesadas e retiradas/transferências reais. Podia mais = o que ainda
                sobrava. Toca num mês para ver as contas e mudar a mesada desse mês.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MonthRow({
  r,
  members,
  overrides,
  taken,
  onSave,
}: {
  r: EnsaioMonth;
  members: Member[];
  overrides: MesadaMonth[];
  taken: Map<string, Map<string, number>>;
  onSave: (memberId: string, month: string, cents: number | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const line = (label: string, cents: number, muted = false) => (
    <div className={`flex justify-between gap-3 ${muted ? "text-tinta/40 dark:text-creme/40" : ""}`}>
      <span className="truncate min-w-0">{label}</span>
      <span className="shrink-0">{formatCents(cents)}</span>
    </div>
  );
  return (
    <>
      <tr className="border-t border-areia/50 dark:border-white/5 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="py-1.5 capitalize">
          {shortMonth(r.month)}
          {r.partial && <span className="text-tinta/40 dark:text-creme/40">*</span>} {open ? "▾" : "▸"}
        </td>
        <td className="text-right">{euros(r.joaoCents + r.joanaCents)}</td>
        <td className="text-right">{euros(r.despesasCents)}</td>
        <td className="text-right">{euros(r.retiradasCents)}</td>
        <td className={`text-right font-medium ${r.podiaMaisCents < 0 ? "text-terracota" : "text-petroleo"}`}>
          {euros(r.podiaMaisCents)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="pb-3 text-xs text-tinta/60 dark:text-creme/60 space-y-0.5">
            {r.partial && <div className="text-tinta/40 dark:text-creme/40">* mês com dados parciais</div>}
            {line("+ Entradas do João (valor normal)", r.joaoCents)}
            {line("+ Recebido pela Joana (App1)", r.joanaCents)}
            {line("− Despesas da casa (prestações, fixas, variáveis, atividade)", r.despesasCents)}
            {line("− Pago em mesadas", r.mesadasPagasCents)}
            {line("− Outras retiradas e transferências entre contas", r.retiradasCents - r.mesadasPagasCents)}
            <div className={`flex justify-between gap-3 font-medium ${r.podiaMaisCents < 0 ? "text-terracota" : "text-petroleo"}`}>
              <span>= Podia ter pago mais</span>
              <span>{formatCents(r.podiaMaisCents)}</span>
            </div>
            <div className="flex justify-between gap-3 pt-1 text-tinta/50 dark:text-creme/50">
              <span>Com as mesadas definidas ({formatCents(r.mesadasCents)}) sobrava</span>
              <span>{formatCents(r.sobraCents)}</span>
            </div>
            {r.semCategoriaCents > 0 && (
              <div className="text-terracota">
                {formatCents(r.semCategoriaCents)} de saídas sem categoria não contam —{" "}
                <Link to="/por-rever" className="underline">categoriza-as</Link>.
              </div>
            )}
            <div className="pt-2 space-y-2">
              {members.map((m) => (
                <MemberMonth
                  key={m.id}
                  member={m}
                  month={r.month}
                  value={mesadaFor(m, r.month, overrides)}
                  custom={isOverride(m.id, r.month, overrides)}
                  taken={taken.get(m.id)?.get(r.month) ?? 0}
                  onSave={onSave}
                />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MemberMonth({
  member,
  month,
  value,
  custom,
  taken,
  onSave,
}: {
  member: Member;
  month: string;
  value: number;
  custom: boolean;
  taken: number;
  onSave: (memberId: string, month: string, cents: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const over = taken - value;
  return (
    <div className="rounded-lg bg-areia/30 dark:bg-white/5 px-3 py-2">
      <div className="flex justify-between gap-3 text-sm text-tinta dark:text-creme">
        <span>
          Mesada {member.display_name}
          {!custom && <span className="text-xs text-tinta/40 dark:text-creme/40"> · base</span>}
        </span>
        <span className="tnum">{formatCents(value)}</span>
      </div>
      {taken > 0 && (
        <div className={`flex justify-between gap-3 ${over > 100 ? "text-terracota" : ""}`}>
          <span>Tirou de facto</span>
          <span className="tnum">
            {formatCents(taken)}
            {over > 100 ? ` (+${formatCents(over)})` : ""}
          </span>
        </div>
      )}
      {!editing ? (
        <div className="flex gap-3 mt-1">
          <button
            className="text-petroleo"
            onClick={() => {
              setAmount((value / 100).toFixed(2).replace(".", ","));
              setEditing(true);
            }}
          >
            Mudar neste mês
          </button>
          {custom && (
            <button className="text-tinta/50 dark:text-creme/50" onClick={() => onSave(member.id, month, null)}>
              Voltar ao valor base
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2 items-center mt-1">
          <input
            className="input py-1 text-xs w-28 tnum"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`Mesada de ${member.display_name} em ${month}`}
          />
          <button
            className="text-petroleo font-medium"
            onClick={async () => {
              const cents = parseCents(amount);
              if (cents == null) return;
              await onSave(member.id, month, cents);
              setEditing(false);
            }}
          >
            Guardar
          </button>
          <button className="text-tinta/50 dark:text-creme/50" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
