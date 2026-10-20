import { useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { errorMessage } from "@/lib/errors";

export function Login() {
  const { signIn, signUp, configured } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("A password tem de ter pelo menos 6 caracteres.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "up") await signUp(email, password);
      else await signIn(email, password);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <img src="/favicon.svg" alt="" className="w-16 h-16 mx-auto" />
          <h1 className="text-3xl font-display">Contas a Dois</h1>
          <p className="text-tinta/60 dark:text-creme/60">
            O dinheiro da casa, sem complicações.
          </p>
        </div>

        {!configured && (
          <div className="card p-4 text-sm border-terracota/30 bg-terracota/5">
            <p className="font-medium text-terracota">Supabase por configurar</p>
            <p className="text-tinta/60 dark:text-creme/60 mt-1">
              Define <code>VITE_SUPABASE_URL</code> e{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> no <code>.env</code> (ver README).
            </p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              className="input"
              placeholder="o-teu@email.pt"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              required
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-terracota">{error}</p>}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "…" : mode === "up" ? "Criar conta" : "Entrar"}
          </button>
        </form>

        <p className="text-center text-sm text-tinta/60 dark:text-creme/60">
          {mode === "in" ? "Primeira vez?" : "Já têm conta?"}{" "}
          <button
            className="text-petroleo font-medium"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
          >
            {mode === "in" ? "Criar conta" : "Entrar"}
          </button>
        </p>

        <p className="text-center text-xs text-tinta/40 dark:text-creme/40">
          Entras uma vez — a app guarda a sessão.
        </p>
      </div>
    </div>
  );
}

function messageFor(err: unknown): string {
  const m = errorMessage(err);
  if (/Invalid login credentials/i.test(m)) return "Email ou password errados.";
  if (/already registered|already exists/i.test(m)) return "Este email já tem conta — entra em vez de criar.";
  if (/rate/i.test(m)) return "Demasiadas tentativas. Tenta daqui a pouco.";
  return m || "Ocorreu um erro.";
}
