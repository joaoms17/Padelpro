import { useEffect, useState } from "react";
import { Sheet } from "./Sheet";
import { CategoryPicker } from "./CategoryPicker";
import { useHousehold } from "@/data/household";
import { setCategory, setNote, setSplits } from "@/data/transactions";
import { formatSigned, formatDate, parseCents, formatCents } from "@/lib/format";
import type { Transaction } from "@/lib/types";

interface SplitRow {
  categoryId: string | null;
  amount: string;
}

export function TransactionSheet({
  tx,
  onClose,
  onSaved,
}: {
  tx: Transaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { categoriesById } = useHousehold();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNoteText] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [splits, setSplitRows] = useState<SplitRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCategoryId(tx?.category_id ?? null);
    setNoteText(tx?.note ?? "");
    setSplitting(false);
    setSplitRows([]);
    setError(null);
  }, [tx]);

  if (!tx) return null;

  const totalCents = Math.abs(tx.amount_cents);
  const splitSum = splits.reduce((a, s) => a + (parseCents(s.amount) ?? 0), 0);
  const splitRemainder = totalCents - splitSum;

  function startSplit() {
    setSplitting(true);
    setSplitRows([
      { categoryId: categoryId, amount: "" },
      { categoryId: null, amount: "" },
    ]);
  }

  async function save() {
    if (!tx) return;
    setBusy(true);
    setError(null);
    try {
      if (splitting) {
        const parsed = splits
          .filter((s) => s.categoryId && (parseCents(s.amount) ?? 0) > 0)
          .map((s) => ({
            categoryId: s.categoryId as string,
            amountCents: parseCents(s.amount) as number,
          }));
        if (parsed.length < 2) {
          setError("Uma divisão precisa de pelo menos 2 partes com categoria.");
          setBusy(false);
          return;
        }
        if (Math.abs(splitRemainder) > 0) {
          setError(`As partes têm de somar ${formatCents(totalCents)}.`);
          setBusy(false);
          return;
        }
        await setSplits(tx.id, parsed);
        await setCategory(tx.id, parsed[0].categoryId);
      } else {
        await setCategory(tx.id, categoryId);
        await setSplits(tx.id, []); // clear any prior split
      }
      if (note !== (tx.note ?? "")) await setNote(tx.id, note);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!tx} onClose={onClose} title="Movimento">
      <div className="space-y-4">
        <div className="card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">
                {tx.merchant_clean || tx.description_raw || "Movimento"}
              </div>
              <div className="text-sm text-tinta/50 dark:text-creme/50">
                {formatDate(tx.booking_date)} · {originLabel(tx.source)}
              </div>
            </div>
            <div
              className={`text-xl font-display tnum ${
                tx.amount_cents >= 0 ? "text-petroleo" : "text-terracota"
              }`}
            >
              {formatSigned(tx.amount_cents)}
            </div>
          </div>
        </div>

        {!splitting ? (
          <>
            <div>
              <label className="label" htmlFor="cat">Categoria</label>
              <CategoryPicker id="cat" value={categoryId} onChange={setCategoryId} />
            </div>
            <button className="btn-ghost w-full text-sm" onClick={startSplit}>
              Dividir por várias categorias
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Divisão</span>
              <button
                className="text-sm text-tinta/50 dark:text-creme/50"
                onClick={() => setSplitting(false)}
              >
                Cancelar divisão
              </button>
            </div>
            {splits.map((s, i) => (
              <div key={i} className="flex gap-2">
                <div className="flex-1">
                  <CategoryPicker
                    value={s.categoryId}
                    allowNone={false}
                    onChange={(cid) =>
                      setSplitRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, categoryId: cid } : r)),
                      )
                    }
                  />
                </div>
                <input
                  inputMode="decimal"
                  className="input w-28 text-right"
                  placeholder="0,00"
                  value={s.amount}
                  onChange={(e) =>
                    setSplitRows((rows) =>
                      rows.map((r, j) =>
                        j === i ? { ...r, amount: e.target.value } : r,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <div className="flex items-center justify-between text-sm">
              <button
                className="text-petroleo"
                onClick={() =>
                  setSplitRows((r) => [...r, { categoryId: null, amount: "" }])
                }
              >
                + Adicionar parte
              </button>
              <span
                className={
                  splitRemainder === 0
                    ? "text-petroleo"
                    : "text-terracota tnum"
                }
              >
                {splitRemainder === 0
                  ? "Soma certa"
                  : `Falta ${formatCents(splitRemainder)}`}
              </span>
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="note">Nota</label>
          <input
            id="note"
            className="input"
            placeholder="Opcional"
            value={note}
            onChange={(e) => setNoteText(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-terracota">{error}</p>}

        <button className="btn-primary w-full" disabled={busy} onClick={save}>
          {busy ? "A guardar…" : "Guardar"}
        </button>
        {tx.category_id && categoriesById.get(tx.category_id) && (
          <p className="text-center text-xs text-tinta/40 dark:text-creme/40">
            Atual: {categoriesById.get(tx.category_id)!.name}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function originLabel(s: string): string {
  return s === "banco"
    ? "Banco"
    : s === "applepay"
      ? "Apple Pay"
      : s === "extrato"
        ? "Extrato"
        : "Manual";
}
