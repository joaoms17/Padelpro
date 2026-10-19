import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { useHousehold } from "@/data/household";
import { listGoals, createGoal, reserveGoal, deleteGoal } from "@/data/goals";
import { goalMonthlyNeeded } from "@/lib/metrics";
import { formatCents, parseCents, formatDate } from "@/lib/format";
import type { Goal } from "@/lib/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function Objetivos() {
  const { householdId } = useHousehold();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      setGoals(await listGoals(householdId));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reserve(g: Goal, text: string) {
    const cents = parseCents(text);
    if (cents == null) return;
    await reserveGoal(g.id, cents);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Objetivos" subtitle="Reservas dentro da almofada." />
        <button className="btn-ghost text-sm px-3 py-2" onClick={() => setCreating(true)}>Novo</button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : goals.length === 0 ? (
        <EmptyState title="Sem objetivos" hint="Férias, concertos, amortização… cria o primeiro." />
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const pct = g.target_cents > 0 ? Math.min(1, g.reserved_cents / g.target_cents) : 0;
            const perMonth = goalMonthlyNeeded(g.target_cents, g.reserved_cents, g.due_date, todayISO());
            return (
              <Card key={g.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{g.name}</div>
                  <button className="text-xs text-terracota" onClick={async () => { await deleteGoal(g.id); await load(); }}>✕</button>
                </div>
                <div className="h-2 rounded-full bg-areia/60 dark:bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-petroleo" style={{ width: `${pct * 100}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="tnum">{formatCents(g.reserved_cents)} / {formatCents(g.target_cents)}</span>
                  {g.due_date && <span className="text-tinta/50 dark:text-creme/50">até {formatDate(g.due_date)}</span>}
                </div>
                {perMonth > 0 && (
                  <div className="text-xs text-terracota">
                    Faltam {formatCents(perMonth)}/mês para chegar a tempo
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    inputMode="decimal"
                    className="input py-1.5 text-sm w-32"
                    placeholder="Reservar €"
                    defaultValue={g.reserved_cents ? (g.reserved_cents / 100).toString() : ""}
                    onBlur={(e) => reserve(g, e.target.value)}
                  />
                  <span className="text-xs text-tinta/40 dark:text-creme/40">reservado</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating && <CreateGoal householdId={householdId!} onClose={() => setCreating(false)} onSaved={load} />}
    </div>
  );
}

function CreateGoal({ householdId, onClose, onSaved }: { householdId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const cents = parseCents(target);
    if (!name.trim() || !cents) return;
    setBusy(true);
    try {
      await createGoal({ householdId, name: name.trim(), targetCents: cents, dueDate: due || null });
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Novo objetivo">
      <div className="space-y-4">
        <div><label className="label">Nome</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Férias 2027" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Valor alvo</label>
            <input inputMode="decimal" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00 €" /></div>
          <div><label className="label">Data limite</label>
            <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy ? "A guardar…" : "Criar objetivo"}</button>
      </div>
    </Sheet>
  );
}
