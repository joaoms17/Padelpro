import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { HouseholdProvider } from "@/data/household";
import { PinLock } from "@/auth/PinLock";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/screens/Login";
import { Inicio } from "@/screens/Inicio";
import { Movimentos } from "@/screens/Movimentos";
import { Meses } from "@/screens/Meses";
import { Plano } from "@/screens/Plano";
import { Regras } from "@/screens/Regras";
import { Categorias } from "@/screens/Categorias";
import { LigarBanco, LigarBancoCallback } from "@/screens/LigarBanco";
import { ApplePay } from "@/screens/ApplePay";
import { Notificacoes } from "@/screens/Notificacoes";
import { Definicoes } from "@/screens/Definicoes";

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
          <Route path="/meses" element={<Meses />} />
          <Route path="/meses/:mes" element={<Meses />} />
          <Route path="/plano" element={<Plano />} />
          <Route path="/movimentos" element={<Movimentos />} />
          <Route path="/definicoes" element={<Definicoes />} />
          <Route path="/regras" element={<Regras />} />
          <Route path="/categorias" element={<Categorias />} />
          {/* Old screens, folded into the four above */}
          <Route path="/metricas" element={<Navigate to="/meses" replace />} />
          <Route path="/conferir" element={<Navigate to="/meses" replace />} />
          <Route path="/eventos" element={<Navigate to="/meses" replace />} />
          <Route path="/mesadas" element={<Navigate to="/plano" replace />} />
          <Route path="/ensaio" element={<Navigate to="/plano" replace />} />
          <Route path="/dinheiro" element={<Navigate to="/plano" replace />} />
          <Route path="/orcamento" element={<Navigate to="/plano" replace />} />
          <Route path="/entradas-previstas" element={<Navigate to="/plano#entradas" replace />} />
          <Route path="/objetivos" element={<Navigate to="/plano" replace />} />
          <Route path="/por-rever" element={<Navigate to="/movimentos?vista=categorizar" replace />} />
          <Route path="/pergunta" element={<Navigate to="/" replace />} />
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
