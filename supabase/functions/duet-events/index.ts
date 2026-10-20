// duet-events — Joana's events (and what is still to receive) from the Duet
// app, a separate Supabase project. Read-only: the key (DUET_SECRET_KEY, a
// secret key of that project) never leaves the server, and only the fields
// the forecast needs are returned to members of the household.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import {
  toDuetEvents,
  toDuetReceipts,
  validRange,
  type DuetEventRow,
  type DuetPaymentRow,
  type DuetProjectRow,
} from "../_shared/duet.ts";

const DEFAULT_URL = "https://pqekervyrdrirbvwtqqz.supabase.co";

function duetClient() {
  const key = (Deno.env.get("DUET_SECRET_KEY") ?? "").trim();
  if (!key) return null;
  return createClient(Deno.env.get("DUET_URL") || DEFAULT_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A missing optional table (e.g. payments before Duet's payments.sql) reads as empty. */
function missingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205");
}

async function readDuet(from: string, to: string, today: string) {
  const db = duetClient()!;
  // select("*"): optional columns (zero_confirmed…) may not exist in every Duet DB.
  const { data: events, error } = await db
    .from("events")
    .select("*")
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date")
    .limit(2000);
  if (error) throw new Error(`Duet: ${error.message}`);
  const rows = (events ?? []) as DuetEventRow[];

  const payments: DuetPaymentRow[] = [];
  const ids = rows.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error: pErr } = await db
      .from("payments")
      .select("event_id, paid_at, amount")
      .in("event_id", ids.slice(i, i + 150));
    if (missingTable(pErr)) break;
    if (pErr) throw new Error(`Duet: ${pErr.message}`);
    payments.push(...((data ?? []) as DuetPaymentRow[]));
  }

  const { data: projects, error: prErr } = await db.from("projects").select("id, name, kind, color");
  if (prErr && !missingTable(prErr)) throw new Error(`Duet: ${prErr.message}`);

  return toDuetEvents(rows, payments, (projects ?? []) as DuetProjectRow[], today);
}

/** Received money by payment date (for checking it against the bank). */
async function readReceipts(from: string, to: string) {
  const db = duetClient()!;
  const { data: pays, error: pErr } = await db
    .from("payments")
    .select("event_id, paid_at, amount")
    .gte("paid_at", from)
    .lte("paid_at", to)
    .limit(5000);
  if (pErr && !missingTable(pErr)) throw new Error(`Duet: ${pErr.message}`);
  const payments = (pErr ? [] : pays ?? []) as DuetPaymentRow[];

  // Old events without payments count by their paid flag.
  const flagged: DuetEventRow[] = [];
  for (const q of [
    db.from("events").select("*").eq("paid", true).gte("paid_at", from).lte("paid_at", to),
    db.from("events").select("*").eq("paid", true).is("paid_at", null).gte("event_date", from).lte("event_date", to),
  ]) {
    const { data, error } = await q.limit(2000);
    if (error) throw new Error(`Duet: ${error.message}`);
    flagged.push(...((data ?? []) as DuetEventRow[]));
  }

  // Which flagged events have payments at all (any date): those don't count by flag.
  const withPayments = new Set<string>();
  const fIds = flagged.map((e) => e.id);
  for (let i = 0; i < fIds.length && !pErr; i += 150) {
    const { data, error } = await db.from("payments").select("event_id").in("event_id", fIds.slice(i, i + 150));
    if (error) throw new Error(`Duet: ${error.message}`);
    for (const r of data ?? []) withPayments.add(r.event_id as string);
  }

  // Titles for the payments' events.
  const events = [...flagged];
  const have = new Set(events.map((e) => e.id));
  const need = [...new Set(payments.map((p) => p.event_id))].filter((id) => !have.has(id));
  for (let i = 0; i < need.length; i += 150) {
    const { data, error } = await db.from("events").select("*").in("id", need.slice(i, i + 150));
    if (error) throw new Error(`Duet: ${error.message}`);
    events.push(...((data ?? []) as DuetEventRow[]));
  }

  const { data: projects, error: prErr } = await db.from("projects").select("id, name, kind, color");
  if (prErr && !missingTable(prErr)) throw new Error(`Duet: ${prErr.message}`);
  return toDuetReceipts(events, payments, withPayments, (projects ?? []) as DuetProjectRow[], from, to);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);

    // Deploy smoke test: proves the key works, without returning any event.
    if (body?.check) {
      if (!isCronRequest(req)) return json({ error: "não autenticado" }, 401);
      if (!duetClient()) return json({ configured: false });
      const year = today.slice(0, 4);
      const events = await readDuet(`${year}-01-01`, `${year}-12-31`, today);
      return json({ configured: true, events: events.length });
    }

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    if (!duetClient()) return json({ configured: false, events: [], receipts: [] });

    const range = validRange(body?.from, body?.to);
    if (!range) return json({ error: "intervalo de datas inválido" }, 400);
    if (body?.receipts) return json({ configured: true, receipts: await readReceipts(range.from, range.to) });
    return json({ configured: true, events: await readDuet(range.from, range.to, today) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
