import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useHousehold } from "@/data/household";
import {
  loadMembers,
  updateMesada,
  loadSettings,
  setCushionTarget,
  setPriceTable,
  setTaxRate,
} from "@/data/settings";
import { parseCents, formatCents } from "@/lib/format";
import type { Member } from "@/lib/types";

const PRICE_ROWS = [
  { key: "noiva", label: "Noiva (prova + dia)" },
  { key: "convidada", label: "Convidada" },
  { key: "deslocacao_km", label: "Deslocação (€/km)" },
];

export function Dinheiro() {
  const navigate = useNavigate();
  const { householdId } = useHousehold();
  const [members, setMembers] = useState<Member[]>([]);
  const [cushion, setCushion] = useState<number>(3);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [taxPct, setTaxPct] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const [m, s] = await Promise.all([loadMembers(householdId), loadSettings(householdId)]);
      setMembers(m);
      if (s) {
        setCushion(s.cushion_target_months);
        setPrices(s.price_table ?? {});
        setTaxPct(s.tax_rate ? String(Math.round(s.tax_rate * 100)) : "");
      }
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveMesada(m: Member, valor: string, dia: string) {
    const cents = parseCents(valor) ?? 0;
    const day = dia.trim() ? Math.min(28, Math.max(1, Number(dia))) : null;
    await updateMesada(m.id, cents, day);
    await load();
    flash();
  }

  async function saveCushion(months: number) {
    if (!householdId) return;
    await setCushionTarget(householdId, months);
    setCushion(months);
    flash();
  }

  async function saveTax(text: string) {
    if (!householdId) return;
    const pct = Number(text.replace(/[^\d]/g, ""));
    const rate = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) / 100 : 0;
    await setTaxRate(householdId, rate);
    flash();
  }

  async function savePrice(key: string, text: string) {
    if (!householdId) return;
    const cents = parseCents(text);
    const next = { ...prices };
    if (cents == null) delete next[key];
    else next[key] = cents;
    setPrices(next);
    await setPriceTable(householdId, next);
    flash();
  }

  return (
    <div className="space-y-6">
      <button
        className="text-sm text-tinta/50 dark:text-creme/50"
        onClick={() => navigate("/definicoes")}
      >
        ‹ Definições
      </button>
      <PageHeader title="Dinheiro" subtitle="Mesadas e alvo da almofada." />

      {saved && <p className="text-sm text-petroleo">Guardado ✓</p>}

      {loading ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : (
        <>
          <section>
            <SectionTitle>Mesadas</SectionTitle>
            <div className="space-y-3">
              {members.map((m) => (
                <MesadaRow key={m.id} member={m} onSave={saveMesada} />
              ))}
            </div>
            <p className="text-xs text-tinta/40 dark:text-creme/40 mt-2">
              A transferência mensal para a conta pessoal de cada um. A app regista
              a saída, mas não acompanha o que fazes com ela.
            </p>
          </section>

          <section>
            <SectionTitle>Alvo da almofada</SectionTitle>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-tinta/70 dark:text-creme/70">
                  Meses de despesas guardados
                </span>
                <div className="flex items-center gap-3">
                  <button
                    className="w-9 h-9 rounded-full border border-areia dark:border-white/10"
                    onClick={() => saveCushion(Math.max(0, cushion - 1))}
                  >
                    −
                  </button>
                  <span className="text-2xl font-display tnum w-8 text-center">{cushion}</span>
                  <button
                    className="w-9 h-9 rounded-full border border-areia dark:border-white/10"
                    onClick={() => saveCushion(cushion + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle>Tabela de preços dos eventos</SectionTitle>
            <Card className="space-y-3">
              {PRICE_ROWS.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-tinta/70 dark:text-creme/70">{row.label}</span>
                  <PriceInput
                    initial={prices[row.key]}
                    onSave={(txt) => savePrice(row.key, txt)}
                  />
                </div>
              ))}
            </Card>
            <p className="text-xs text-tinta/40 dark:text-creme/40 mt-2">
              Sugere o valor ao criar um evento. Podes sempre ajustar.
            </p>
          </section>

          <section>
            <SectionTitle>Reserva para impostos</SectionTitle>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-tinta/70 dark:text-creme/70">
                  Taxa sobre a rentabilidade da atividade
                </span>
                <div className="flex items-center gap-1">
                  <input
                    inputMode="numeric"
                    className="input py-1.5 w-20 text-right"
                    placeholder="0"
                    defaultValue={taxPct}
                    onBlur={(e) => saveTax(e.target.value)}
                  />
                  <span className="text-tinta/50 dark:text-creme/50">%</span>
                </div>
              </div>
            </Card>
            <p className="text-xs text-tinta/40 dark:text-creme/40 mt-2">
              Mostra quanto guardar dos eventos para o IRS. 0% desliga.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function PriceInput({
  initial,
  onSave,
}: {
  initial: number | undefined;
  onSave: (text: string) => void;
}) {
  const [val, setVal] = useState(initial != null ? (initial / 100).toString() : "");
  return (
    <input
      inputMode="decimal"
      className="input py-1.5 w-28 text-right"
      placeholder="€"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onSave(val)}
    />
  );
}

function MesadaRow({
  member,
  onSave,
}: {
  member: Member;
  onSave: (m: Member, valor: string, dia: string) => void;
}) {
  const [valor, setValor] = useState(
    member.mesada_cents ? (member.mesada_cents / 100).toString() : "",
  );
  const [dia, setDia] = useState(member.mesada_day ? String(member.mesada_day) : "");

  return (
    <Card>
      <div className="font-medium mb-2">{member.display_name}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Valor</label>
          <input
            inputMode="decimal"
            className="input"
            placeholder="0,00 €"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onBlur={() => onSave(member, valor, dia)}
          />
        </div>
        <div>
          <label className="label">Dia do mês</label>
          <input
            inputMode="numeric"
            className="input"
            placeholder="1–28"
            value={dia}
            onChange={(e) => setDia(e.target.value.replace(/\D/g, ""))}
            onBlur={() => onSave(member, valor, dia)}
          />
        </div>
      </div>
      {member.mesada_cents > 0 && (
        <div className="text-xs text-tinta/40 dark:text-creme/40 mt-2">
          Atual: {formatCents(member.mesada_cents)}
          {member.mesada_day ? ` · dia ${member.mesada_day}` : ""}
        </div>
      )}
    </Card>
  );
}
