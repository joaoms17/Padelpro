import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useHousehold } from "@/data/household";
import { listTransactions, setCategory } from "@/data/transactions";
import { runCategorize } from "@/data/rules";
import {
  listEventProposals,
  confirmEventProposal,
  dismissEventProposal,
  listSettlementProposals,
  confirmSettlement,
  dismissSettlement,
  type EventProposal,
  type SettlementProposal,
} from "@/data/review";
import { formatSigned, formatDate, formatPct, formatCents } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

export function PorRever() {
  const { householdId } = useHousehold();
  const [items, setItems] = useState<Transaction[]>([]);
  const [proposals, setProposals] = useState<EventProposal[]>([]);
  const [settlements, setSettlements] = useState<SettlementProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const [txs, props, setts] = await Promise.all([
        listTransactions({ householdId, onlyReview: true }),
        listEventProposals(householdId),
        listSettlementProposals(householdId),
      ]);
      setItems(txs);
      setProposals(props);
      setSettlements(setts);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  async function confirmProposal(p: EventProposal) {
    if (!householdId) return;
    await confirmEventProposal(householdId, p);
    setProposals((list) => list.filter((x) => x.id !== p.id));
  }
  async function dismissProposal(p: EventProposal) {
    await dismissEventProposal(p);
    setProposals((list) => list.filter((x) => x.id !== p.id));
  }
  async function confirmSett(p: SettlementProposal) {
    if (!householdId) return;
    await confirmSettlement(householdId, p);
    setSettlements((list) => list.filter((x) => x.id !== p.id));
  }
  async function dismissSett(p: SettlementProposal) {
    await dismissSettlement(p);
    setSettlements((list) => list.filter((x) => x.id !== p.id));
  }

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
      setMsg(
        `${r.assigned} categorizados, ${r.review} por rever.` +
          (r.ai_pending ? ` Faltam ${r.ai_pending} — carrega outra vez para continuar.` : "") +
          (r.ai_error ? ` (IA indisponível: ${r.ai_error})` : ""),
      );
      await load();
    } catch (e) {
      setMsg(errorMessage(e));
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

      {proposals.length > 0 && (
        <div className="space-y-2">
          {proposals.map((p) => (
            <Card key={p.id} className="border-petroleo/30 bg-petroleo/5">
              <div className="text-sm">
                Isto é o <b>{p.ref.kind}</b> {p.ref.client_name ? `de ${p.ref.client_name}` : "de um evento"}?{" "}
                <span className="tnum">{formatCents(p.ref.amount_cents)}</span>{" "}
                <span className="text-tinta/50 dark:text-creme/50">· {p.ref.method}</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn-primary text-sm px-4 py-1.5" onClick={() => confirmProposal(p)}>Sim</button>
                <button className="btn-ghost text-sm px-4 py-1.5" onClick={() => dismissProposal(p)}>Não</button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {settlements.length > 0 && (
        <div className="space-y-2">
          {settlements.map((p) => (
            <Card key={p.id} className="border-petroleo/30 bg-petroleo/5">
              <div className="text-sm">
                Este depósito de <b className="tnum">{formatCents(p.ref.amount_cents)}</b> liquida{" "}
                {p.ref.payment_ids.length} pagamento(s) por transferir?
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn-primary text-sm px-4 py-1.5" onClick={() => confirmSett(p)}>Sim</button>
                <button className="btn-ghost text-sm px-4 py-1.5" onClick={() => dismissSett(p)}>Não</button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <button className="btn-primary w-full" onClick={categorizeAuto} disabled={running}>
        {running ? "A categorizar…" : "Categorizar automaticamente"}
      </button>
      {msg && <p className="text-sm text-petroleo">{msg}</p>}

      {loading ? (
        <div className="py-8 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : items.length === 0 && proposals.length === 0 && settlements.length === 0 ? (
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
