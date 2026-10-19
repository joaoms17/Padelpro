import { useState } from "react";
import { useAuth } from "@/auth/AuthProvider";

export function Login() {
  const { sendCode, verifyCode, configured } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendCode(email);
      setStep("code");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email, code);
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
              <code>VITE_SUPABASE_ANON_KEY</code> no <code>.env</code> (ver
              README).
            </p>
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={onSend} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
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
            {error && <p className="text-sm text-terracota">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "A enviar…" : "Receber código"}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <div>
              <label className="label" htmlFor="code">
                Código de 6 dígitos (enviado para {email})
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                className="input text-center text-2xl tracking-[0.5em] font-display"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            {error && <p className="text-sm text-terracota">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "A validar…" : "Entrar"}
            </button>
            <button
              type="button"
              className="btn-ghost w-full"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Usar outro email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function messageFor(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/Invalid.*token|otp/i.test(m)) return "Código inválido ou expirado.";
  if (/rate/i.test(m)) return "Demasiadas tentativas. Tenta daqui a pouco.";
  return m || "Ocorreu um erro.";
}
