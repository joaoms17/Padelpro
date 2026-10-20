import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, SectionTitle, EmptyState } from "@/components/ui";
import { useHousehold } from "@/data/household";
import { loadMonthTx, loadRecentTx, setBudget } from "@/data/budget";
import {
  spentByCategory,
  categoryProgress,
  recurringCandidates,
  fixedOverdue,
  type MonthTx,
  type CategoryProgress,
} from "@/lib/budget";
import { formatCents, parseCents, formatSigned } from "@/lib/format";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const LEVEL_COLOR = { ok: "#2E6B66", warn: "#A64B25", over: "#A64B25" };

export function Orcamento() {
  const { householdId, categories, groupLabels } = useHousehold();
  const [monthTx, setMonthTx] = useState<MonthTx[]>([]);
  const [recentTx, setRecentTx] = useState<MonthTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const month = thisMonth();

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        loadMonthTx(householdId, month),
        loadRecentTx(householdId),
      ]);
      setMonthTx(m);
      setRecentTx(r);
    } finally {
      setLoading(false);
    }
  }, [householdId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const spent = useMemo(() => spentByCategory(monthTx), [monthTx]);
  const budgetCats = categories.filter((c) => c.grp === "variavel" || c.grp === "atividade");

  const progress = useMemo(() => {
    const map = new Map<string, CategoryProgress>();
    for (const c of budgetCats) {
      map.set(
        c.id,
        categoryProgress(c.id, spent.get(c.id) ?? 0, c.budget_cents, month, todayISO()),
      );
    }
    return map;
  }, [budgetCats, spent, month]);

  const alerts = useMemo(() => {
    const out: string[] = [];
    for (const c of budgetCats) {
      const p = progress.get(c.id);
      if (!p || !p.budgetCents) continue;
      if (p.level === "over") out.push(`${c.name} ultrapassou o orçamento`);
      else if (p.level === "warn") out.push(`${c.name} já vai em ${Math.round(p.pct * 100)}%`);
      else if (p.paceOver) out.push(`Ao ritmo atual, ${c.name} chega a ${formatCents(p.projectedCents)}`);
    }
    return out;
  }, [budgetCats, progress]);

  async function saveBudget(categoryId: string, text: string) {
    const cents = text.trim() === "" ? null : parseCents(text);
    await setBudget(categoryId, cents);
    setEdits((e) => {
      const next = { ...e };
      delete next[categoryId];
      return next;
    });
    await load();
  }

  // Recurring fixed charges from recent history.
  const fixed = useMemo(() => recurringCandidates(recentTx), [recentTx]);
  const seenKeysThisMonth = useMemo(() => {
    const keys = new Set<string>();
    for (const t of monthTx) {
      if (t.amount_cents < 0) keys.add((t.counterparty || t.merchant_clean || "").toLowerCase().trim());
    }
    return keys;
  }, [monthTx]);

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Orçamento" />
        <div className="py-8 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Orçamento" subtitle="Limites por categoria e fixas previstas." />

      {alerts.length > 0 && (
        <div className="card p-4 border-terracota/30 bg-terracota/5 space-y-1">
          {alerts.map((a) => (
            <div key={a} className="text-sm text-terracota flex gap-2">
              <span>⚠️</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      <section>
        <SectionTitle>{groupLabels.variavel}</SectionTitle>
        <div className="space-y-3">
          {budgetCats
            .filter((c) => c.grp === "variavel")
            .map((c) => {
              const p = progress.get(c.id)!;
              const editing = edits[c.id] ?? null;
              return (
                <div key={c.id} className="card p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-sm text-tinta/60 dark:text-creme/60 tnum">
                      {formatCents(p.spentCents)}
                      {p.budgetCents ? ` / ${formatCents(p.budgetCents)}` : ""}
                    </span>
                  </div>
                  {p.budgetCents ? (
                    <div className="h-2 rounded-full bg-areia/60 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, p.pct * 100)}%`,
                          backgroundColor: LEVEL_COLOR[p.level],
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <input
                      inputMode="decimal"
                      className="input py-1.5 text-sm w-32"
                      placeholder="Orçamento €"
                      value={editing ?? (p.budgetCents ? (p.budgetCents / 100).toString() : "")}
                      onChange={(e) => setEdits((ed) => ({ ...ed, [c.id]: e.target.value }))}
                      onBlur={(e) => editing !== null && saveBudget(c.id, e.target.value)}
                    />
                    {p.paceOver && p.level === "ok" && (
                      <span className="text-xs text-terracota">ritmo alto</span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      <section>
        <SectionTitle>Fixas previstas</SectionTitle>
        {fixed.length === 0 ? (
          <EmptyState title="Ainda sem padrões" hint="As fixas aparecem após alguns meses de histórico." />
        ) : (
          <div className="card divide-y divide-areia/50 dark:divide-white/5">
            {fixed.map((f) => {
              const seen = seenKeysThisMonth.has(f.key);
              const overdue = fixedOverdue(f.expectedDay, todayISO(), seen);
              return (
                <div key={f.key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium capitalize truncate">{f.key}</div>
                    <div className="text-xs text-tinta/50 dark:text-creme/50">
                      ~dia {f.expectedDay} · {f.occurrences}× nos últimos meses
                      {overdue && <span className="text-terracota"> · em falta</span>}
                      {seen && <span className="text-petroleo"> · pago este mês</span>}
                    </div>
                  </div>
                  <span className="tnum text-terracota shrink-0">
                    {formatSigned(-f.expectedCents)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
