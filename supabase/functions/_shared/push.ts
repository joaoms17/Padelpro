// Web Push sender for Edge Functions (spec 10). VAPID keys live in secrets.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

function configured(): boolean {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:contas-a-dois@example.com",
    pub,
    priv,
  );
  return true;
}

/**
 * Push a notification to a household's members. When `prefKey` is given, only
 * members whose notify_prefs[prefKey] !== false receive it. Dead subscriptions
 * (404/410) are pruned. Returns how many notifications were sent.
 */
export async function pushToHousehold(
  svc: SupabaseClient,
  householdId: string,
  payload: PushPayload,
  prefKey?: string,
): Promise<number> {
  if (!configured()) return 0;

  const { data: members } = await svc
    .from("members")
    .select("id, notify_prefs")
    .eq("household_id", householdId);

  const memberIds = (members ?? [])
    .filter((m) => {
      if (!prefKey) return true;
      const prefs = (m.notify_prefs ?? {}) as Record<string, boolean>;
      return prefs[prefKey] !== false; // default on
    })
    .map((m) => m.id as string);
  if (memberIds.length === 0) return 0;

  const { data: subs } = await svc
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("member_id", memberIds);

  let sent = 0;
  for (const s of subs ?? []) {
    const subscription = {
      endpoint: s.endpoint as string,
      keys: { p256dh: s.p256dh as string, auth: s.auth as string },
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await svc.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
  }
  return sent;
}
