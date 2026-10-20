import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader, Card } from "@/components/ui";
import { useHousehold } from "@/data/household";
import {
  getConnection,
  startAuth,
  completeCallback,
  syncNow,
  daysUntil,
} from "@/data/bank";
import { runCategorize } from "@/data/rules";
import { formatCents } from "@/lib/format";
import type { BankConnection } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  }).format(new Date(iso));
}

/** Running as the installed home-screen app (iOS standalone / display-mode). */
function isInstalledApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export function LigarBanco() {
  const { householdId, contaCasa, reload } = useHousehold();
  const [conn, setConn] = useState<BankConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"auth" | "sync" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      setConn(await getConnection(householdId));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The bank authorization hops to the Santander app and comes back in the
  // default browser; from the installed app that is a different browser
  // session, so Enable Banking reports "Authentication session has expired".
  const installed = isInstalledApp();
  const [copied, setCopied] = useState(false);
  const pageUrl = `${window.location.origin}/ligar-banco`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function connect() {
    if (installed) return;
    setBusy("auth");
    setError(null);
    try {
      window.location.href = await startAuth();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function doSync() {
    if (!householdId) return;
    setBusy("sync");
    setError(null);
    setMsg(null);
    try {
      // A partial sync (one account failed) still imported the others.
      const r = await syncNow(householdId);
      if (r.error) setError(r.error);
      if (!r.error || r.processed > 0) setMsg(`${r.processed} movimentos sincronizados.`);
      if (r.processed > 0) {
        await runCategorize(householdId).catch(() => {});
      }
      await Promise.all([refresh(), reload()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const days = daysUntil(conn?.valid_until ?? null);
  const expired = days != null && days < 0;
  const expiringSoon = days != null && days >= 0 && days <= 14;
  const active = conn?.status === "active" && !expired;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ligação ao banco"
        subtitle="Santander por open banking (só leitura)."
      />

      {loading ? (
        <div className="py-8 text-center text-tinta/50 dark:text-creme/50">
          A carregar…
        </div>
      ) : (
        <>
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  active ? "bg-petroleo" : expired ? "bg-terracota" : "bg-areia"
                }`}
              />
              <span className="font-medium">
                {active
                  ? "Ligado"
                  : expired
                    ? "Ligação expirada"
                    : conn
                      ? "Inativo"
                      : "Sem ligação"}
              </span>
            </div>

            {conn && (
              <dl className="text-sm space-y-1.5">
                <Line k="Banco" v={conn.aspsp_name} />
                <Line k="Última sincronização" v={fmtDateTime(conn.last_sync_at)} />
                <Line
                  k="Consentimento"
                  v={
                    days == null
                      ? "—"
                      : expired
                        ? "Expirado"
                        : `Expira em ${days} dias`
                  }
                  tone={expired ? "bad" : expiringSoon ? "warn" : undefined}
                />
                {contaCasa && (
                  <Line
                    k="Saldo da Conta Casa"
                    v={formatCents(contaCasa.balance_cents)}
                  />
                )}
              </dl>
            )}

            {conn?.last_error && (
              <p className="mt-3 text-xs text-terracota bg-terracota/5 rounded-lg p-2 break-words">
                Último erro: {conn.last_error}
              </p>
            )}
          </Card>

          {(expiringSoon || expired) && (
            <Card className="border-terracota/30 bg-terracota/5">
              <p className="text-sm text-terracota">
                {expired
                  ? "A ligação expirou. Renova para voltar a sincronizar."
                  : `A ligação ao Santander expira em ${days} dias. Renova quando puderes.`}
              </p>
            </Card>
          )}

          {installed ? (
            <Card className="border-terracota/30 bg-terracota/5 space-y-2">
              <p className="text-sm text-terracota font-medium">
                Liga o banco no Safari ou no computador
              </p>
              <p className="text-sm text-tinta/70 dark:text-creme/70">
                Na app instalada, o banco volta para o Safari, que não tem a sessão
                da autorização, e ela expira. Abre este endereço no computador
                (recomendado) ou no Safari e entra com a tua conta:
              </p>
              <p className="text-xs break-all font-mono">{pageUrl}</p>
              <button className="btn-ghost w-full" onClick={copyLink}>
                {copied ? "Copiado ✓" : "Copiar endereço"}
              </button>
            </Card>
          ) : (
            isMobile() && !active && (
              <p className="text-xs text-tinta/60 dark:text-creme/60 leading-relaxed">
                Dica: no telemóvel faz isto no <b>browser predefinido</b> (normalmente
                o Safari) — depois de confirmares na app do Santander, o banco volta
                sempre para esse browser. No computador é mais simples.
              </p>
            )
          )}

          {msg && <p className="text-sm text-petroleo">{msg}</p>}
          {error && <p className="text-sm text-terracota">{error}</p>}

          <div className="space-y-3">
            {active && (
              <button
                className="btn-primary w-full"
                disabled={busy !== null}
                onClick={doSync}
              >
                {busy === "sync" ? "A sincronizar…" : "Sincronizar agora"}
              </button>
            )}
            <button
              className={active ? "btn-ghost w-full" : "btn-primary w-full"}
              disabled={busy !== null || installed}
              onClick={connect}
            >
              {busy === "auth"
                ? "A abrir o banco…"
                : conn
                  ? "Renovar ligação"
                  : "Ligar banco"}
            </button>
          </div>

          <p className="text-xs text-tinta/40 dark:text-creme/40 leading-relaxed">
            A app nunca mexe em dinheiro: lê apenas os movimentos e o saldo. A
            sincronização automática corre 2×/dia.
          </p>
        </>
      )}
    </div>
  );
}

function Line({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-tinta/50 dark:text-creme/50">{k}</dt>
      <dd
        className={
          tone === "bad"
            ? "text-terracota font-medium"
            : tone === "warn"
              ? "text-terracota"
              : "text-tinta dark:text-creme"
        }
      >
        {v}
      </dd>
    </div>
  );
}

/** Handles the redirect back from the bank: /ligar-banco/callback?code&state */
export function LigarBancoCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setError("Resposta do banco incompleta.");
      return;
    }
    completeCallback(code, state)
      .then(() => navigate("/ligar-banco", { replace: true }))
      .catch((e) => setError(errorMessage(e)));
  }, [params, navigate]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-6">
      {error ? (
        <>
          <p className="text-terracota font-medium">Não foi possível ligar</p>
          <p className="text-sm text-tinta/60 dark:text-creme/60">{error}</p>
          <button
            className="btn-ghost"
            onClick={() => navigate("/ligar-banco", { replace: true })}
          >
            Voltar
          </button>
        </>
      ) : (
        <>
          <div className="h-8 w-8 rounded-full border-2 border-areia border-t-terracota animate-spin" />
          <p className="text-tinta/60 dark:text-creme/60">A concluir a ligação…</p>
        </>
      )}
    </div>
  );
}
