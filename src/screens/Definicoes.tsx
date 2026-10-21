import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import { PageHeader, SectionTitle } from "@/components/ui";
import { ImportStatement } from "@/components/ImportStatement";
import { supabase } from "@/lib/supabase";
import { isPinSet, setPin, clearPin } from "@/auth/PinLock";
import { getStoredTheme, applyTheme, type Theme } from "@/lib/theme";

function Row({
  title,
  hint,
  right,
  to,
}: {
  title: string;
  hint?: string;
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

/** "há 3 h" / "há 2 dias". */
function ago(iso: string | null): string {
  if (!iso) return "nunca";
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  if (h < 1) return "há pouco";
  if (h < 36) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export function Definicoes() {
  const { member, signOut } = useAuth();
  const { householdId } = useHousehold();
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [pinOn, setPinOn] = useState(isPinSet());
  const [pinEntry, setPinEntry] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [bank, setBank] = useState<{ last_sync_at: string | null; valid_until: string | null } | null>(null);

  useEffect(() => {
    if (!householdId) return;
    supabase
      .from("bank_connections")
      .select("last_sync_at, valid_until, status")
      .eq("household_id", householdId)
      .then(({ data }) => {
        const rows = (data ?? []) as { last_sync_at: string | null; valid_until: string | null; status: string }[];
        setBank(rows.find((r) => r.status === "active") ?? rows[0] ?? null);
      });
  }, [householdId]);

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

  const until = bank?.valid_until ? new Date(bank.valid_until).toLocaleDateString("pt-PT", { day: "numeric", month: "short" }) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Definições" subtitle={member ? `Sessão de ${member.display_name}` : undefined} />

      <section className="card p-5">
        <SectionTitle>Banco</SectionTitle>
        <Row
          title="Santander"
          hint={bank ? `Atualizado ${ago(bank.last_sync_at)}${until ? ` · ligação válida até ${until}` : ""}` : "Por ligar"}
          to="/ligar-banco"
        />
      </section>

      <section className="card p-5">
        <SectionTitle>Categorias</SectionTitle>
        <Row title="Categorias" hint="Criar, renomear, ordenar, juntar" to="/categorias" />
        <Row title="Regras" hint="O que cada regra categoriza sozinha" to="/regras" />
      </section>

      <section className="card p-5">
        <SectionTitle>Avisos</SectionTitle>
        <Row title="Notificações" hint="O que cada um recebe no telemóvel" to="/notificacoes" />
      </section>

      <section className="card p-5">
        <SectionTitle>Aparência e PIN</SectionTitle>

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

      <section className="card p-5">
        <SectionTitle>Avançado</SectionTitle>
        <button className="w-full text-left" onClick={() => setImporting(true)}>
          <Row title="Importar extratos antigos" hint="CSV/XLSX do Santander, para meses antes da ligação" />
        </button>
        <Row title="Atalho Apple Pay" hint="Registar compras no momento (iPhone)" to="/apple-pay" />
      </section>

      <ImportStatement open={importing} onClose={() => setImporting(false)} onDone={() => setImporting(false)} />

      <button className="btn-ghost w-full" onClick={() => signOut()}>
        Terminar sessão
      </button>

      <p className="text-center text-xs text-tinta/40 dark:text-creme/40">
        Contas a Dois · v0.2.0
      </p>
    </div>
  );
}
