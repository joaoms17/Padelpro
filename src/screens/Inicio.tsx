import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import { assembleMetrics, type MetricsBundle } from "@/data/metrics";
import { loadMembers } from "@/data/settings";
import { Card, SectionTitle } from "@/components/ui";
import { ForecastCard } from "@/components/ForecastCard";
import { formatCents } from "@/lib/format";

const QUICK_LINKS = [
  { to: "/ensaio", label: "Ensaio das mesadas", hint: "Como fechava o mês só com mesadas" },
  { to: "/por-rever", label: "Por rever", hint: "Correções e correspondências" },
  { to: "/orcamento", label: "Orçamento", hint: "Limites por categoria" },
  { to: "/objetivos", label: "Objetivos", hint: "Reservas da almofada" },
  { to: "/pergunta", label: "Pergunta à app", hint: "Chat sobre as contas" },
];

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function Inicio() {
  const { member } = useAuth();
  const { householdId, categories, contaCasa } = useHousehold();
  const [m, setM] = useState<MetricsBundle | null>(null);

  const load = useCallback(async () => {
    if (!householdId || categories.length === 0) return;
    const members = await loadMembers(householdId);
    const bundle = await assembleMetrics(
      householdId,
      thisMonth(),
      categories,
      members,
      contaCasa?.balance_cents ?? 0,
      new Date().toISOString().slice(0, 10),
      contaCasa?.id ?? null,
    );
    setM(bundle);
  }, [householdId, categories, contaCasa]);

  useEffect(() => {
    void load();
  }, [load]);

  const nome = member?.display_name ?? "";
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 20 ? "Boa tarde" : "Boa noite";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-tinta/60 dark:text-creme/60">
          {saudacao}{nome ? `, ${nome}` : ""}
        </p>
        <h1 className="text-3xl font-display">Contas a Dois</h1>
      </header>

      {m ? (
        <ForecastCard m={m} />
      ) : (
        <Card className="bg-petroleo/5 border-petroleo/20">
          <div className="text-sm text-tinta/60 dark:text-creme/60">Previsão para o fim do mês</div>
          <div className="text-5xl font-display tnum text-petroleo">—</div>
        </Card>
      )}

      {m && (
        <Card>
          <div className="text-sm text-tinta/60 dark:text-creme/60">Almofada</div>
          <div className="text-2xl font-display tnum">{m.almofadaMeses.toFixed(1)} meses</div>
          <div className="text-xs text-tinta/50 dark:text-creme/50">{formatCents(m.almofadaDisponivelCents)}</div>
        </Card>
      )}

      <div>
        <SectionTitle>Atalhos</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {QUICK_LINKS.map((q) => (
            <Link key={q.to} to={q.to} className="card p-4 block active:scale-[0.99] transition-transform">
              <div className="font-medium">{q.label}</div>
              <div className="text-xs text-tinta/50 dark:text-creme/50 mt-0.5">{q.hint}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
