import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, Card } from "@/components/ui";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import {
  pushSupported,
  isSubscribed,
  subscribePush,
  unsubscribePush,
  savePrefs,
  sendTestNotification,
  NOTIFY_OPTIONS,
  VAPID_PUBLIC_KEY,
  type NotifyPrefs,
} from "@/data/push";
import { errorMessage } from "@/lib/errors";

export function Notificacoes() {
  const navigate = useNavigate();
  const { member } = useAuth();
  const { householdId } = useHousehold();
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<NotifyPrefs>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSubscribed(await isSubscribed());
    setPrefs((member?.notify_prefs as NotifyPrefs) ?? {});
  }, [member]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleSub() {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      if (subscribed) {
        await unsubscribePush();
        setSubscribed(false);
      } else {
        await subscribePush(member.id);
        setSubscribed(true);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePref(key: string) {
    if (!member) return;
    const next = { ...prefs, [key]: prefs[key] === false ? true : false };
    setPrefs(next);
    await savePrefs(member.id, next);
  }

  async function test() {
    if (!householdId) return;
    setMsg(null);
    setError(null);
    try {
      await sendTestNotification(householdId);
      setMsg("Notificação de teste enviada.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const supported = pushSupported();

  return (
    <div className="space-y-5">
      <button className="text-sm text-tinta/50 dark:text-creme/50" onClick={() => navigate("/definicoes")}>
        ‹ Definições
      </button>
      <PageHeader title="Notificações" subtitle="Avisos no telemóvel, por membro." />

      {!supported && (
        <Card className="border-terracota/30 bg-terracota/5">
          <p className="text-sm text-terracota">
            Este dispositivo não suporta notificações. No iPhone, adiciona a app ao
            ecrã principal e abre-a a partir daí.
          </p>
        </Card>
      )}

      {!VAPID_PUBLIC_KEY && (
        <Card className="border-terracota/30 bg-terracota/5">
          <p className="text-sm text-terracota">
            Falta a chave <code>VITE_VAPID_PUBLIC_KEY</code> (ver README).
          </p>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Notificações neste dispositivo</div>
            <div className="text-sm text-tinta/50 dark:text-creme/50">
              {subscribed ? "Ativas" : "Desligadas"}
            </div>
          </div>
          <button
            className={subscribed ? "btn-ghost text-sm px-4 py-2" : "btn-primary text-sm px-4 py-2"}
            disabled={busy || !supported}
            onClick={toggleSub}
          >
            {busy ? "…" : subscribed ? "Desligar" : "Ativar"}
          </button>
        </div>
        {subscribed && (
          <button className="btn-ghost w-full text-sm" onClick={test}>
            Enviar notificação de teste
          </button>
        )}
        {msg && <p className="text-sm text-petroleo">{msg}</p>}
        {error && <p className="text-sm text-terracota">{error}</p>}
      </Card>

      <Card>
        <div className="font-medium">O que quero receber</div>
        <p className="text-sm text-tinta/50 dark:text-creme/50 mb-2">
          Os avisos do plano (limites, contas fixas, entradas, mesadas e Duet) começam quando o plano
          entra em vigor e não se repetem no mesmo mês.
        </p>
        <div className="divide-y divide-areia/50 dark:divide-white/5">
          {NOTIFY_OPTIONS.map((o) => (
            <label key={o.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span>{o.label}</span>
              <input
                type="checkbox"
                className="w-5 h-5 accent-terracota"
                checked={prefs[o.key] !== false}
                onChange={() => togglePref(o.key)}
              />
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}
