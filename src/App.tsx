import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { HouseholdProvider } from "@/data/household";
import { PinLock } from "@/auth/PinLock";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/screens/Login";
import { Inicio } from "@/screens/Inicio";
import { Movimentos } from "@/screens/Movimentos";
import { LigarBanco, LigarBancoCallback } from "@/screens/LigarBanco";
import { Definicoes } from "@/screens/Definicoes";
import {
  PorRever,
  Orcamento,
  Eventos,
  Metricas,
  Objetivos,
  Pergunta,
} from "@/screens/stubs";

function Gate() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-areia border-t-terracota animate-spin" />
      </div>
    );
  }

  if (!session) return <Login />;

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
          <Route path="/metricas" element={<Metricas />} />
          <Route path="/objetivos" element={<Objetivos />} />
          <Route path="/pergunta" element={<Pergunta />} />
          <Route path="/definicoes" element={<Definicoes />} />
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
