import { useState } from "react";
import { Sheet } from "./Sheet";
import { CategoryPicker } from "./CategoryPicker";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import { insertManual } from "@/data/transactions";
import { parseCents } from "@/lib/format";
import { errorMessage } from "@/lib/errors";

const METHODS = ["", "numerário", "mbway", "transferência", "revolut", "cartão"];

export function AddTransaction({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const { householdId, contaCasa } = useHousehold();

  const [kind, setKind] = useState<"saida" | "entrada">("saida");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKind("saida");
    setAmount("");
    setCategoryId(null);
    setMethod("");
    setNote("");
    setError(null);
  }

  async function save() {
    const cents = parseCents(amount);
    if (!cents || cents <= 0) {
      setError("Indica um valor válido.");
      return;
    }
    if (!householdId || !contaCasa) {
      setError("Conta não disponível.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await insertManual({
        householdId,
        accountId: contaCasa.id,
        amountCents: kind === "entrada" ? cents : -cents,
        bookingDate: date,
        categoryId,
        method: method || undefined,
        note: note || undefined,
        createdBy: session?.user.id ?? null,
      });
      reset();
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Novo movimento">
      <div className="space-y-4">
        <div className="flex rounded-full border border-areia dark:border-white/10 overflow-hidden">
          {(["saida", "entrada"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`flex-1 py-2.5 text-sm font-medium ${
                kind === k
                  ? k === "entrada"
                    ? "bg-petroleo text-creme"
                    : "bg-terracota text-creme"
                  : "text-tinta/60 dark:text-creme/60"
              }`}
            >
              {k === "entrada" ? "Entrada" : "Despesa"}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="amount">Valor</label>
          <input
            id="amount"
            inputMode="decimal"
            className="input text-2xl font-display"
            placeholder="0,00 €"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="date">Data</label>
            <input
              id="date"
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="method">Método</label>
            <select
              id="method"
              className="input appearance-none"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m || "—"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="cat">Categoria</label>
          <CategoryPicker id="cat" value={categoryId} onChange={setCategoryId} />
        </div>

        <div>
          <label className="label" htmlFor="note">Nota</label>
          <input
            id="note"
            className="input"
            placeholder="Opcional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-terracota">{error}</p>}

        <button className="btn-primary w-full" disabled={busy} onClick={save}>
          {busy ? "A guardar…" : "Guardar"}
        </button>
      </div>
    </Sheet>
  );
}
