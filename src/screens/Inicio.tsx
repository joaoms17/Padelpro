import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Card, SectionTitle } from "@/components/ui";

const QUICK_LINKS = [
  { to: "/por-rever", label: "Por rever", hint: "Correções e correspondências" },
  { to: "/orcamento", label: "Orçamento", hint: "Limites por categoria" },
  { to: "/objetivos", label: "Objetivos", hint: "Reservas da almofada" },
  { to: "/pergunta", label: "Pergunta à app", hint: "Chat sobre as contas" },
];

export function Inicio() {
  const { member } = useAuth();
  const nome = member?.display_name ?? "";
  const hora = new Date().getHours();
  const saudacao =
    hora < 12 ? "Bom dia" : hora < 20 ? "Boa tarde" : "Boa noite";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-tinta/60 dark:text-creme/60">
          {saudacao}{nome ? `, ${nome}` : ""}
        </p>
        <h1 className="text-3xl font-display">Contas a Dois</h1>
      </header>

      <Card className="bg-petroleo/5 border-petroleo/20">
        <div className="space-y-1">
          <div className="text-sm text-tinta/60 dark:text-creme/60">
            Sobra deste mês
          </div>
          <div className="text-4xl font-display tnum text-petroleo">— €</div>
          <p className="text-sm text-tinta/50 dark:text-creme/50">
            Os valores aparecem quando ligares o banco e importares o extrato
            (M3). O cálculo chega em M8.
          </p>
        </div>
      </Card>

      <div>
        <SectionTitle>Atalhos</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {QUICK_LINKS.map((q) => (
            <Link key={q.to} to={q.to} className="card p-4 block active:scale-[0.99] transition-transform">
              <div className="font-medium">{q.label}</div>
              <div className="text-xs text-tinta/50 dark:text-creme/50 mt-0.5">
                {q.hint}
              </div>
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <SectionTitle>Primeiros passos</SectionTitle>
        <ol className="space-y-2 text-sm text-tinta/70 dark:text-creme/70 list-decimal list-inside">
          <li>Confirmar os membros do agregado em Definições</li>
          <li>Definir mesadas e alvo da almofada</li>
          <li>Importar o extrato dos últimos 12 meses (M2)</li>
          <li>Ligar o Santander por open banking (M3)</li>
        </ol>
        <Link to="/definicoes" className="btn-primary text-sm mt-4">
          Ir para Definições
        </Link>
      </Card>
    </div>
  );
}
