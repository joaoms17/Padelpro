import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { useHousehold } from "@/data/household";
import { listTransactions, type TxFilters } from "@/data/transactions";
import { AddTransaction } from "@/components/AddTransaction";
import { TransactionSheet } from "@/components/TransactionSheet";
import { ImportStatement } from "@/components/ImportStatement";
import { formatSigned, formatCents } from "@/lib/format";
import type { Transaction, TransactionSource } from "@/lib/types";

const SOURCE_BADGE: Record<TransactionSource, string> = {
  banco: "Banco",
  applepay: "Apple Pay",
  manual: "Manual",
  extrato: "Extrato",
};

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

export function Movimentos() {
  const { householdId, categoriesById, loading: hhLoading } = useHousehold();

  const [month, setMonth] = useState(thisMonth());
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<TransactionSource | "">("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const filters: TxFilters = {
        householdId,
        month,
        search: search || undefined,
        source: source || undefined,
        onlyReview: onlyReview || undefined,
      };
      setTxs(await listTransactions(filters));
    } catch {
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, [householdId, month, search, source, onlyReview]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0); // debounce search
    return () => clearTimeout(t);
  }, [load, search]);

  const groups = useMemo(() => {
    const byDay = new Map<string, Transaction[]>();
    for (const t of txs) {
      const list = byDay.get(t.booking_date) ?? [];
      list.push(t);
      byDay.set(t.booking_date, list);
    }
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [txs]);

  const monthTotal = useMemo(
    () => txs.reduce((a, t) => a + t.amount_cents, 0),
    [txs],
  );

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Movimentos" />
        <button
          className="btn-ghost text-sm px-3 py-2"
          onClick={() => setImporting(true)}
        >
          Importar
        </button>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between card px-3 py-2">
        <button
          className="w-9 h-9 rounded-full hover:bg-areia/50 dark:hover:bg-white/5"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <div className="text-center">
          <div className="font-display capitalize">{monthLabel(month)}</div>
          <div
            className={`text-xs tnum ${
              monthTotal >= 0 ? "text-petroleo" : "text-terracota"
            }`}
          >
            {formatSigned(monthTotal)}
          </div>
        </div>
        <button
          className="w-9 h-9 rounded-full hover:bg-areia/50 dark:hover:bg-white/5 disabled:opacity-30"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={month >= thisMonth()}
          aria-label="Mês seguinte"
        >
          ›
        </button>
      </div>

      {/* Search + filters */}
      <input
        className="input"
        placeholder="Pesquisar…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        <Chip active={onlyReview} onClick={() => setOnlyReview((v) => !v)}>
          Por rever
        </Chip>
        {(["", "banco", "applepay", "extrato", "manual"] as const).map((s) => (
          <Chip key={s} active={source === s} onClick={() => setSource(s)}>
            {s === "" ? "Todas" : SOURCE_BADGE[s]}
          </Chip>
        ))}
      </div>

      {/* List */}
      {loading || hhLoading ? (
        <div className="py-10 text-center text-tinta/50 dark:text-creme/50">
          A carregar…
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Sem movimentos neste mês"
          hint="Importa o extrato ou adiciona um movimento com o botão +."
        />
      ) : (
        <div className="space-y-5">
          {groups.map(([day, list]) => (
            <div key={day}>
              <div className="text-xs font-semibold uppercase tracking-wide text-tinta/50 dark:text-creme/50 mb-2">
                {dayLabel(day)}
              </div>
              <div className="card divide-y divide-areia/50 dark:divide-white/5">
                {list.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setEditing(t)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-areia/30 dark:active:bg-white/5"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {t.merchant_clean || t.description_raw || "Movimento"}
                      </div>
                      <div className="text-xs text-tinta/50 dark:text-creme/50 flex items-center gap-1.5">
                        <span>{SOURCE_BADGE[t.source]}</span>
                        <span>·</span>
                        <span
                          className={
                            t.category_id ? "" : "text-terracota/80 font-medium"
                          }
                        >
                          {t.category_id
                            ? (categoriesById.get(t.category_id)?.name ?? "—")
                            : "Por categorizar"}
                        </span>
                      </div>
                    </div>
                    <div
                      className={`tnum shrink-0 ${
                        t.amount_cents >= 0 ? "text-petroleo" : "text-tinta dark:text-creme"
                      }`}
                    >
                      {t.amount_cents >= 0
                        ? formatSigned(t.amount_cents)
                        : formatCents(t.amount_cents)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Floating add button */}
      <button
        className="fixed right-5 bottom-24 z-30 w-14 h-14 rounded-full bg-terracota text-creme text-3xl shadow-card flex items-center justify-center active:scale-95 transition-transform"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        onClick={() => setAdding(true)}
        aria-label="Novo movimento"
      >
        +
      </button>

      <AddTransaction open={adding} onClose={() => setAdding(false)} onSaved={load} />
      <ImportStatement
        open={importing}
        onClose={() => setImporting(false)}
        onDone={load}
      />
      <TransactionSheet
        tx={editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm border transition-colors ${
        active
          ? "bg-tinta text-creme border-tinta dark:bg-creme dark:text-tinta dark:border-creme"
          : "border-areia dark:border-white/10 text-tinta/70 dark:text-creme/70"
      }`}
    >
      {children}
    </button>
  );
}
