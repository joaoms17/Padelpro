import { supabase } from "@/lib/supabase";
import { invokeFn } from "@/lib/invoke";

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();

export type NotifyPrefs = Record<string, boolean>;

// The notifications the server sends (alerts, notify and monthly-close
// functions), one toggle per members.notify_prefs key (on unless false).
// The plan's alerts (limites … joana) only start once the plan is in force.
export const NOTIFY_OPTIONS: { key: string; label: string }[] = [
  { key: "ligacao_banco", label: "Ligação ao banco a expirar" },
  { key: "resumo_semana", label: "Resumo da semana (domingo)" },
  { key: "fecho_mes", label: "Fecho do mês (dia 1)" },
  { key: "limites", label: "Limites e ritmo do dia a dia" },
  { key: "contas_fixas", label: "Contas fixas que ainda não saíram" },
  { key: "entradas", label: "Entradas que ainda não chegaram" },
  { key: "mesadas", label: "Mesadas acima do combinado" },
  { key: "joana", label: "Dinheiro da Duet por chegar à conta" },
];

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Ask permission and subscribe this device; store the subscription. */
export async function subscribePush(memberId: string): Promise<void> {
  if (!pushSupported()) throw new Error("Este dispositivo não suporta notificações.");
  if (!VAPID_PUBLIC_KEY) throw new Error("VAPID público não configurado (VITE_VAPID_PUBLIC_KEY).");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permissão de notificações recusada.");

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });

  const json = sub.toJSON();
  const keys = json.keys ?? {};
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      member_id: memberId,
      endpoint: json.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function unsubscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}

export async function savePrefs(memberId: string, prefs: NotifyPrefs): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update({ notify_prefs: prefs })
    .eq("id", memberId);
  if (error) throw error;
}

export async function sendTestNotification(householdId: string): Promise<void> {
  await invokeFn("notify", { household_id: householdId, test: true });
}
