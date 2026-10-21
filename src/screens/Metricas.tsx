import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { PageHeader, Card, Stat, SectionTitle } from "@/components/ui";
import { useHousehold } from "@/data/household";
import { loadMembers } from "@/data/settings";
import { assembleMetrics, type MetricsBundle } from "@/data/metrics";
import { MESES } from "@/lib/metrics";
import { formatCents, formatPct } from "@/lib/format";

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthShort(mk: string) {
  const [, m] = mk.split("-").map(Number);
  return MESES[m - 1];
}

export function Metricas() {
  const { householdId, categories, contaCasa } = useHousehold();
  const [m, setM] = useState<MetricsBundle | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const members = await loadMembers(householdId);
      const bundle = await assembleMetrics(
        householdId,
        thisMonth(),
        categories,
        members,
        contaCasa?.balance_cents ?? 0,
        todayISO(),
      );
      setM(bundle);
    } finally {
      setLoading(false);
    }
  }, [householdId, categories, contaCasa]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !m) {
    return (
      <div className="space-y-5">
        <PageHeader title="Métricas" />
        <div className="py-8 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      </div>
    );
  }

  const chartData = m.monthlySeries.map((s) => ({
    mes: monthShort(s.month),
    Entradas: Math.round(s.entradas / 100),
    Despesas: Math.round(s.despesas / 100),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Métricas" subtitle="Como está o mês e a almofada." />

      <Link to="/mesadas" className="card p-4 block active:scale-[0.99] transition-transform">
        <div className="font-medium">Módulo Mesadas →</div>
        <div className="text-xs text-tinta/50 dark:text-creme/50 mt-0.5">
          Mês a mês, simulador e mesada sustentável
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <Stat label="Sobra do mês" value={formatCents(m.totals.sobraCents)} tone={m.totals.sobraCents >= 0 ? "positive" : "negative"} />
        </Card>
        <Card>
          <Stat label="Taxa de poupança" value={formatPct(m.totals.taxaPoupanca)} />
        </Card>
      </div>

      <Card className="space-y-3">
        <SectionTitle>Almofada</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Disponível" value={formatCents(m.almofadaDisponivelCents)} />
          <Stat label="Em meses" value={m.almofadaMeses.toFixed(1)} />
        </div>
        <div className="text-sm text-tinta/60 dark:text-creme/60">
          Livre (fora dos objetivos): <b className="tnum">{formatCents(m.almofadaLivreCents)}</b>
        </div>
      </Card>

      <Card>
        <Stat label="Previsão de fim de mês" value={formatCents(m.previsaoCents)} />
        <p className="text-xs text-tinta/40 dark:text-creme/40 mt-1">
          Saldo atual + entradas esperadas − compromissos − variáveis projetadas.
        </p>
      </Card>

      {m.cobertura < 1 && (
        <Card className="border-terracota/30 bg-terracota/5">
          <div className="text-sm text-terracota">
            ⚠️ A base fixa cobre apenas {formatPct(m.cobertura)} das fixas + mesadas.
          </div>
        </Card>
      )}

      <Card className="space-y-1">
        <SectionTitle>Este mês</SectionTitle>
        <Row k="Entradas" v={formatCents(m.totals.entradasCents)} />
        <Row k="Despesas da casa" v={formatCents(m.totals.despesasCasaCents)} />
        <Row k="Mesadas" v={formatCents(m.totals.mesadasCents)} />
        <Row k="Comprometido no dia 1" v={formatPct(m.comprometido)} />
        {m.eventosAReceberCents > 0 && <Row k="A receber de eventos (3m)" v={formatCents(m.eventosAReceberCents)} />}
      </Card>

      <Card>
        <SectionTitle>Últimos 12 meses</SectionTitle>
        <div className="h-56 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,43,47,0.08)" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#8a8178" }} />
              <YAxis tick={{ fontSize: 11, fill: "#8a8178" }} width={44} />
              <Tooltip
                formatter={(v: number) => `${v} €`}
                contentStyle={{ borderRadius: 12, border: "1px solid #EAE1D3", fontSize: 12 }}
              />
              <Line type="monotone" dataKey="Entradas" stroke="#2E6B66" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Despesas" stroke="#A64B25" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 text-xs text-tinta/60 dark:text-creme/60 justify-center">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-petroleo inline-block" /> Entradas</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-terracota inline-block" /> Despesas</span>
        </div>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-tinta/50 dark:text-creme/50">{k}</span>
      <span className="tnum">{v}</span>
    </div>
  );
}
