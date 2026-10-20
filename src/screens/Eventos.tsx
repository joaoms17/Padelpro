import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Card, SectionTitle, EmptyState, Stat } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { useHousehold } from "@/data/household";
import {
  listEvents,
  listPayments,
  listActivityExpenses,
  createEvent,
  addPayment,
  settlePayment,
  deletePayment,
  deleteEvent,
  updateEventStatus,
} from "@/data/events";
import { buildICS } from "@/lib/ics";
import { activityYearReport, type YearReport } from "@/lib/activityYear";
import {
  eventDue,
  eventPaid,
  eventOutstanding,
  moneyOutsideHouse,
  activityMetrics,
  aReceber,
  suggestStatus,
  type EventRow,
  type Payment,
  type EventStatus,
  type PaymentMethod,
} from "@/lib/events";
import { formatCents, formatSigned, formatDate, formatPct, parseCents } from "@/lib/format";

const TYPES = ["Noiva", "Convidadas", "Concerto", "Outro"];
const METHODS: PaymentMethod[] = ["transferencia", "mbway", "numerario", "revolut"];
const STATUS_LABEL: Record<EventStatus, string> = {
  pedido: "Pedido",
  confirmado: "Confirmado",
  realizado: "Realizado",
  pago: "Pago",
  cancelado: "Cancelado",
};
const STATUS_COLOR: Record<EventStatus, string> = {
  pedido: "bg-areia text-tinta",
  confirmado: "bg-petroleo/15 text-petroleo",
  realizado: "bg-petroleo/15 text-petroleo",
  pago: "bg-petroleo text-creme",
  cancelado: "bg-terracota/15 text-terracota",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthBounds(): [string, string] {
  const d = new Date();
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
  return [start, end];
}

export function Eventos() {
  const { householdId, categories } = useHousehold();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [yearReport, setYearReport] = useState<YearReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openEvent, setOpenEvent] = useState<EventRow | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const evs = await listEvents(householdId);
      const pays = await listPayments(evs.map((e) => e.id));
      setEvents(evs);
      setPayments(pays);

      // Annual activity summary (current year).
      const year = new Date().getFullYear();
      const atividadeCats = categories.filter((c) => c.grp === "atividade");
      const atividadeById = new Map(atividadeCats.map((c) => [c.id, c.name]));
      const expenses = await listActivityExpenses(householdId, atividadeCats.map((c) => c.id), year);
      setYearReport(
        activityYearReport(
          evs.map((e) => ({ date: e.date, status: e.status })),
          pays.map((p) => ({ amount_cents: p.amount_cents, received_at: p.received_at })),
          expenses.map((x) => ({ category: atividadeById.get(x.category_id ?? "") ?? "Outras", amount_cents: x.amount_cents, date: x.booking_date })),
          year,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [householdId, categories]);

  function exportICS() {
    const ics = buildICS(
      events.map((e) => ({ id: e.id, date: e.date, type: e.type, client_name: e.client_name })),
      new Date().toISOString(),
    );
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "eventos-joana.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const paymentsByEvent = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of payments) (m.get(p.event_id) ?? m.set(p.event_id, []).get(p.event_id)!).push(p);
    return m;
  }, [payments]);

  const metrics = useMemo(() => {
    const [start, end] = monthBounds();
    return activityMetrics(events, payments, start, end, 0);
  }, [events, payments]);

  const outside = useMemo(() => moneyOutsideHouse(payments), [payments]);
  const toReceive = useMemo(
    () => aReceber(events, paymentsByEvent, todayISO(), 3),
    [events, paymentsByEvent],
  );

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Eventos" />
        <div className="py-8 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Eventos" subtitle="A atividade da Joana." />
        <button className="btn-ghost text-sm px-3 py-2" onClick={() => setCreating(true)}>
          Novo
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card><Stat label="Recebido este mês" value={formatCents(metrics.receitaCents)} tone="positive" /></Card>
        <Card><Stat label="A receber (3 meses)" value={formatCents(toReceive)} /></Card>
      </div>

      {outside > 0 && (
        <Card className="border-terracota/30 bg-terracota/5">
          <div className="text-sm text-terracota">
            Dinheiro dos eventos ainda fora da Conta Casa:{" "}
            <b className="tnum">{formatCents(outside)}</b>
          </div>
        </Card>
      )}

      <section>
        <SectionTitle>Eventos</SectionTitle>
        {events.length === 0 ? (
          <EmptyState title="Sem eventos" hint="Cria o primeiro com «Novo»." />
        ) : (
          <div className="space-y-2">
            {events.map((ev) => {
              const pays = paymentsByEvent.get(ev.id) ?? [];
              const out = eventOutstanding(ev, pays);
              return (
                <button
                  key={ev.id}
                  onClick={() => setOpenEvent(ev)}
                  className="card p-4 w-full text-left active:scale-[0.99] transition-transform"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {ev.client_name || ev.type}{" "}
                        <span className="text-tinta/40 dark:text-creme/40 text-sm">· {ev.type}</span>
                      </div>
                      <div className="text-xs text-tinta/50 dark:text-creme/50">{formatDate(ev.date)}</div>
                    </div>
                    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${STATUS_COLOR[ev.status]}`}>
                      {STATUS_LABEL[ev.status]}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-tinta/60 dark:text-creme/60 tnum">
                      {formatCents(eventPaid(pays))} / {formatCents(eventDue(ev))}
                    </span>
                    {out > 0 && <span className="text-terracota tnum">falta {formatCents(out)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {metrics.receitaCents > 0 && (
        <Card className="space-y-1">
          <SectionTitle>Este mês</SectionTitle>
          <Line k="Receita" v={formatCents(metrics.receitaCents)} />
          <Line k="Eventos" v={String(metrics.nEventos)} />
          <Line k="Valor médio" v={formatCents(metrics.mediaEventoCents)} />
          <Line k="Margem" v={formatPct(metrics.margem)} />
        </Card>
      )}

      {yearReport && yearReport.receitaCents > 0 && (
        <Card className="space-y-1">
          <SectionTitle>Resumo {yearReport.year} (IRS)</SectionTitle>
          <Line k="Receita" v={formatCents(yearReport.receitaCents)} />
          <Line k="Gastos da atividade" v={formatCents(yearReport.gastosCents)} />
          <Line k="Rentabilidade" v={formatCents(yearReport.rentabilidadeCents)} />
          <Line k="Margem" v={formatPct(yearReport.margem)} />
          {yearReport.gastosPorCategoria.length > 0 && (
            <div className="pt-2 mt-1 border-t border-areia/50 dark:border-white/5 space-y-1">
              {yearReport.gastosPorCategoria.map((g) => (
                <Line key={g.categoria} k={g.categoria} v={formatCents(g.cents)} />
              ))}
            </div>
          )}
        </Card>
      )}

      {events.length > 0 && (
        <button className="btn-ghost w-full text-sm" onClick={exportICS}>
          Exportar eventos para o calendário (.ics)
        </button>
      )}

      {creating && (
        <CreateEvent
          householdId={householdId!}
          onClose={() => setCreating(false)}
          onSaved={load}
        />
      )}
      {openEvent && (
        <EventDetail
          event={openEvent}
          payments={paymentsByEvent.get(openEvent.id) ?? []}
          onClose={() => setOpenEvent(null)}
          onChanged={async () => {
            await load();
            setOpenEvent(null);
          }}
        />
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-tinta/50 dark:text-creme/50">{k}</span>
      <span className="tnum">{v}</span>
    </div>
  );
}

function CreateEvent({
  householdId,
  onClose,
  onSaved,
}: {
  householdId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState("Noiva");
  const [client, setClient] = useState("");
  const [date, setDate] = useState(todayISO());
  const [service, setService] = useState("");
  const [busy, setBusy] = useState(false);

  function onType(t: string) {
    setType(t);
  }

  async function save() {
    setBusy(true);
    try {
      await createEvent({
        householdId,
        date,
        type,
        clientName: client || null,
        serviceCents: parseCents(service) ?? 0,
      });
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Novo evento">
      <div className="space-y-4">
        <div>
          <label className="label">Tipo</label>
          <select className="input appearance-none" value={type} onChange={(e) => onType(e.target.value)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div><label className="label">Cliente</label>
          <input className="input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nome" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Data</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Valor</label>
            <input inputMode="decimal" className="input" value={service} onChange={(e) => setService(e.target.value)} placeholder="0,00 €" /></div>
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>
          {busy ? "A guardar…" : "Criar evento"}
        </button>
      </div>
    </Sheet>
  );
}

function EventDetail({
  event,
  payments,
  onClose,
  onChanged,
}: {
  event: EventRow;
  payments: Payment[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<Payment["kind"]>("sinal");
  const [method, setMethod] = useState<PaymentMethod>("mbway");
  const [busy, setBusy] = useState(false);

  const out = eventOutstanding(event, payments);
  const suggested = suggestStatus(event, payments);

  async function recebi() {
    const cents = parseCents(amount);
    if (!cents || cents <= 0) return;
    setBusy(true);
    try {
      const location = method === "numerario" || method === "revolut" ? "por_transferir" : "conta_casa";
      await addPayment({ eventId: event.id, kind, amountCents: cents, receivedAt: todayISO(), method, location });
      // Auto-advance to "pago" when this payment fully covers the event.
      const newPaid = eventPaid(payments) + cents;
      if (newPaid >= eventDue(event) && event.status !== "pago" && event.status !== "cancelado") {
        await updateEventStatus(event.id, "pago");
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={event.client_name || event.type}>
      <div className="space-y-4">
        <Card className="space-y-1">
          <Line k="Tipo" v={event.type} />
          <Line k="Data" v={formatDate(event.date)} />
          <Line k="Serviço" v={formatCents(eventDue(event))} />
          <Line k="Pago" v={formatCents(eventPaid(payments))} />
          {out > 0 && <Line k="Falta" v={formatCents(out)} />}
        </Card>

        {/* Status actions */}
        <div className="flex flex-wrap gap-2">
          {(["confirmado", "realizado", "pago", "cancelado"] as EventStatus[]).map((s) => (
            <button
              key={s}
              className={`text-sm rounded-full px-3 py-1.5 border ${
                event.status === s ? "bg-tinta text-creme border-tinta dark:bg-creme dark:text-tinta" : "border-areia dark:border-white/10"
              }`}
              onClick={async () => { await updateEventStatus(event.id, s); onChanged(); }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
          {suggested === "pago" && event.status !== "pago" && (
            <span className="text-xs text-petroleo self-center">↑ sugerido: Pago</span>
          )}
        </div>

        {/* Payments */}
        <div>
          <div className="flex items-center justify-between">
            <SectionTitle>Pagamentos</SectionTitle>
            <button className="text-sm text-petroleo" onClick={() => setAdding((v) => !v)}>
              {adding ? "Fechar" : "Recebi"}
            </button>
          </div>

          {adding && (
            <div className="card p-4 space-y-3 mb-3">
              <div className="grid grid-cols-2 gap-2">
                <select className="input appearance-none" value={kind} onChange={(e) => setKind(e.target.value as Payment["kind"])}>
                  <option value="sinal">Sinal</option>
                  <option value="restante">Restante</option>
                  <option value="outro">Outro</option>
                </select>
                <select className="input appearance-none" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <input inputMode="decimal" className="input" placeholder="Valor €" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button className="btn-primary w-full" disabled={busy} onClick={recebi}>Registar</button>
            </div>
          )}

          {payments.length === 0 ? (
            <p className="text-sm text-tinta/50 dark:text-creme/50">Sem pagamentos.</p>
          ) : (
            <div className="card divide-y divide-areia/50 dark:divide-white/5">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div>
                    <div className="capitalize">{p.kind} · {p.method}</div>
                    <div className="text-xs text-tinta/50 dark:text-creme/50">
                      {p.received_at ? formatDate(p.received_at) : "—"}
                      {p.location === "por_transferir" && <span className="text-terracota"> · por transferir</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tnum text-petroleo">{formatSigned(p.amount_cents)}</span>
                    {p.location === "por_transferir" && (
                      <button className="text-xs text-petroleo" onClick={async () => { await settlePayment(p.id); onChanged(); }}>
                        Entrou
                      </button>
                    )}
                    <button className="text-xs text-terracota" onClick={async () => { await deletePayment(p.id); onChanged(); }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn-ghost w-full text-terracota" onClick={async () => { await deleteEvent(event.id); onChanged(); }}>
          Apagar evento
        </button>
      </div>
    </Sheet>
  );
}
