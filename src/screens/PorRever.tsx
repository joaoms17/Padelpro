import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useHousehold } from "@/data/household";
import { listTransactions, setCategory } from "@/data/transactions";
import { runCategorize } from "@/data/rules";
import { formatSigned, formatDate, formatPct } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export function PorRever() {
  const { householdId } = useHousehold();
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      setItems(await listTransactions({ householdId, onlyReview: true }));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(tx: Transaction, categoryId: string | null) {
    if (!categoryId) return;
    await setCategory(tx.id, categoryId);
    setItems((list) => list.filter((t) => t.id !== tx.id));
  }

  async function categorizeAuto() {
    if (!householdId) return;
    setRunning(true);
    setMsg(null);
    try {
      const r = await runCategorize(householdId);
      setMsg(`${r.assigned} categorizados, ${r.review} por rever.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Por rever"
        subtitle="Movimentos sem categoria ou com baixa confiança da IA."
      />

      <button className="btn-primary w-full" onClick={categorizeAuto} disabled={running}>
        {running ? "A categorizar…" : "Categorizar automaticamente"}
      </button>
      {msg && <p className="text-sm text-petroleo">{msg}</p>}

      {loading ? (
        <div className="py-8 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nada por rever 🎉" hint="Tudo categorizado." />
      ) : (
        <div className="space-y-3">
          {items.map((tx) => (
            <div key={tx.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {tx.merchant_clean || tx.description_raw || "Movimento"}
                  </div>
                  <div className="text-xs text-tinta/50 dark:text-creme/50">
                    {formatDate(tx.booking_date)}
                    {tx.category_source === "ai" && tx.confidence != null && (
                      <span className="ml-1 text-terracota/70">
                        · IA incerta ({formatPct(tx.confidence)})
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className={`tnum shrink-0 ${
                    tx.amount_cents >= 0 ? "text-petroleo" : "text-tinta dark:text-creme"
                  }`}
                >
                  {formatSigned(tx.amount_cents)}
                </div>
              </div>
              <CategoryPicker
                value={null}
                allowNone={false}
                onChange={(cid) => assign(tx, cid)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
