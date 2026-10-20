import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { HouseholdProvider } from "@/data/household";
import { PinLock } from "@/auth/PinLock";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/screens/Login";
import { Inicio } from "@/screens/Inicio";
import { Movimentos } from "@/screens/Movimentos";
import { PorRever } from "@/screens/PorRever";
import { Regras } from "@/screens/Regras";
import { Categorias } from "@/screens/Categorias";
import { EntradasPrevistas } from "@/screens/EntradasPrevistas";
import { Orcamento } from "@/screens/Orcamento";
import { Dinheiro } from "@/screens/Dinheiro";
import { Eventos } from "@/screens/Eventos";
import { Objetivos } from "@/screens/Objetivos";
import { LigarBanco, LigarBancoCallback } from "@/screens/LigarBanco";
import { ApplePay } from "@/screens/ApplePay";
import { Notificacoes } from "@/screens/Notificacoes";
import { Pergunta } from "@/screens/Pergunta";
import { Definicoes } from "@/screens/Definicoes";

// Lazy — keeps Recharts out of the initial bundle.
const Metricas = lazy(() =>
  import("@/screens/Metricas").then((m) => ({ default: m.Metricas })),
);

function Gate() {
  const { loading, session, member, memberError, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-areia border-t-terracota animate-spin" />
      </div>
    );
  }

  if (!session) return <Login />;

  // This app is for exactly two people. A third sign-in can't become a member.
  if (memberError) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-4xl">🔒</div>
        <div className="space-y-1">
          <h1 className="text-xl font-display">Esta app é só para dois</h1>
          <p className="text-sm text-tinta/60 dark:text-creme/60">
            O agregado já está completo (João e Joana).
          </p>
        </div>
        <button className="btn-ghost" onClick={() => signOut()}>Terminar sessão</button>
      </div>
    );
  }

  // Signed in but the member row is still being created.
  if (!member) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-areia border-t-terracota animate-spin" />
      </div>
    );
  }

  return (
    <PinLock>
      <HouseholdProvider>
        <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Inicio />} />
          <Route path="/movimentos" element={<Movimentos />} />
          <Route path="/por-rever" element={<PorRever />} />
          <Route path="/orcamento" element={<Orcamento />} />
          <Route path="/eventos" element={<Eventos />} />
          <Route
            path="/metricas"
            element={
              <Suspense fallback={<div className="py-10 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>}>
                <Metricas />
              </Suspense>
            }
          />
          <Route path="/objetivos" element={<Objetivos />} />
          <Route path="/pergunta" element={<Pergunta />} />
          <Route path="/definicoes" element={<Definicoes />} />
          <Route path="/regras" element={<Regras />} />
          <Route path="/categorias" element={<Categorias />} />
          <Route path="/entradas-previstas" element={<EntradasPrevistas />} />
          <Route path="/dinheiro" element={<Dinheiro />} />
          <Route path="/apple-pay" element={<ApplePay />} />
          <Route path="/notificacoes" element={<Notificacoes />} />
          <Route path="/ligar-banco" element={<LigarBanco />} />
          <Route path="/ligar-banco/callback" element={<LigarBancoCallback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HouseholdProvider>
    </PinLock>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
