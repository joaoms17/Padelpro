import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader, SectionTitle } from "@/components/ui";
import { isPinSet, setPin, clearPin } from "@/auth/PinLock";
import { getStoredTheme, applyTheme, type Theme } from "@/lib/theme";

function Row({
  title,
  hint,
  milestone,
  right,
  to,
}: {
  title: string;
  hint?: string;
  milestone?: string;
  right?: React.ReactNode;
  to?: string;
}) {
  const inner = (
    <>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {hint && (
          <div className="text-sm text-tinta/50 dark:text-creme/50">{hint}</div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {milestone && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-petroleo bg-petroleo/10 rounded-full px-2 py-0.5">
            {milestone}
          </span>
        )}
        {right}
        {to && <span className="text-tinta/30 dark:text-creme/30">›</span>}
      </div>
    </>
  );

  const cls =
    "flex items-center justify-between gap-3 py-3 border-b border-areia/50 dark:border-white/5 last:border-0";
  return to ? (
    <Link to={to} className={`${cls} active:opacity-60`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Definicoes() {
  const { member, signOut } = useAuth();
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [pinOn, setPinOn] = useState(isPinSet());
  const [pinEntry, setPinEntry] = useState<string | null>(null);

  function chooseTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
  }

  async function savePin() {
    if (pinEntry && /^\d{4}$/.test(pinEntry)) {
      await setPin(pinEntry);
      setPinOn(true);
      setPinEntry(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Definições" subtitle="Configura a app do vosso jeito." />

      {/* Agregado */}
      <section className="card p-5">
        <SectionTitle>Agregado</SectionTitle>
        <Row
          title={member?.display_name ?? "Membro"}
          hint={member ? "Sessão iniciada" : "A carregar…"}
        />
        <Row title="Membros" hint="João e Joana" milestone="M1" />
        <Row title="Conta Casa (Santander)" hint="Cotitulares · todo o dinheiro entra aqui" milestone="M3" />
      </section>

      {/* Dinheiro */}
      <section className="card p-5">
        <SectionTitle>Dinheiro</SectionTitle>
        <Row title="Entradas previstas" hint="Ordenado, despesas de representação… para a previsão" to="/entradas-previstas" />
        <Row title="Mesadas" hint="Valor e dia por pessoa" to="/dinheiro" />
        <Row title="Categorias" hint="Separadores e opções: criar, renomear, ordenar" to="/categorias" />
        <Row title="Regras" hint="O que cada regra categoriza — mudar ou apagar" to="/regras" />
      </section>

      {/* Ligações */}
      <section className="card p-5">
        <SectionTitle>Ligações</SectionTitle>
        <Row title="Ligação ao banco" hint="Enable Banking · Santander" to="/ligar-banco" />
        <Row title="Atalho Apple Pay" hint="Token e URL por iPhone" to="/apple-pay" />
        <Row title="Notificações" hint="Web Push por membro" to="/notificacoes" />
      </section>

      {/* Dados */}
      <section className="card p-5">
        <SectionTitle>Dados</SectionTitle>
        <Row title="Importar extrato" hint="CSV/XLSX do Santander" milestone="M2" />
        <Row title="Exportar dados" hint="CSV" milestone="M2" />
      </section>

      {/* App — functional in M1 */}
      <section className="card p-5">
        <SectionTitle>App</SectionTitle>

        <Row
          title="Tema"
          hint="Claro, escuro ou automático"
          right={
            <div className="flex rounded-full border border-areia dark:border-white/10 overflow-hidden text-sm">
              {(["light", "dark", "system"] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => chooseTheme(t)}
                  className={`px-3 py-1.5 ${
                    theme === t
                      ? "bg-terracota text-creme"
                      : "text-tinta/60 dark:text-creme/60"
                  }`}
                >
                  {t === "light" ? "Claro" : t === "dark" ? "Escuro" : "Auto"}
                </button>
              ))}
            </div>
          }
        />

        <Row
          title="Bloqueio por PIN"
          hint={pinOn ? "Ativo" : "Desligado"}
          right={
            pinOn ? (
              <button
                className="text-sm text-terracota"
                onClick={() => {
                  clearPin();
                  setPinOn(false);
                }}
              >
                Remover
              </button>
            ) : pinEntry === null ? (
              <button className="text-sm text-petroleo" onClick={() => setPinEntry("")}>
                Definir
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <input
                  inputMode="numeric"
                  maxLength={4}
                  autoFocus
                  className="input w-20 py-1.5 text-center tracking-widest"
                  value={pinEntry}
                  onChange={(e) => setPinEntry(e.target.value.replace(/\D/g, ""))}
                />
                <button className="text-sm text-petroleo" onClick={savePin}>
                  OK
                </button>
              </span>
            )
          }
        />
      </section>

      <button className="btn-ghost w-full" onClick={() => signOut()}>
        Terminar sessão
      </button>

      <p className="text-center text-xs text-tinta/40 dark:text-creme/40">
        Contas a Dois · v0.1.0
      </p>
    </div>
  );
}
