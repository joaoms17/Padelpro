import { useEffect, useState } from "react";
import { loadDuetReceipts, type DuetReceiptsResult } from "@/data/duet";
import { duetShare } from "@/lib/meses";
import { formatPct } from "@/lib/format";
import { Eur } from "./kit";

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

/**
 * Joana's month: what she marked as received in Duet against what reached the
 * house account. The difference stays with her (her taxes): it is not a debt.
 * Hidden while Duet is not set up.
 */
export function JoanaDuetCard({ month, bankCents }: { month: string; bankCents: number }) {
  const [res, setRes] = useState<DuetReceiptsResult | null>(null);

  useEffect(() => {
    let alive = true;
    setRes(null);
    void loadDuetReceipts(`${month}-01`, lastDay(month)).then((r) => {
      if (alive) setRes(r);
    });
    return () => {
      alive = false;
    };
  }, [month]);

  if (!res) return <p className="text-xs text-tinta/40 dark:text-creme/40 py-1">A ver a Duet…</p>;
  if (!res.configured) {
    return res.error ? <p className="text-xs text-tinta/40 dark:text-creme/40 py-1">Não consegui ver a Duet: {res.error}</p> : null;
  }

  const { duet, bank, share } = duetShare(res.receipts, bankCents);
  return (
    <div className="rounded-2xl bg-areia/40 dark:bg-white/5 px-3 py-2.5 text-sm space-y-1">
      <p>
        Recebeu na Duet <Eur cents={duet} className="font-medium" /> · chegou à conta <Eur cents={bank} className="font-medium" />
        {share != null && <span className="text-tinta/60 dark:text-creme/60"> ({formatPct(share)})</span>}
      </p>
      <p className="text-xs text-tinta/50 dark:text-creme/50">
        {res.receipts.length === 0
          ? "Nada marcado como recebido na Duet este mês."
          : "A diferença fica com a Joana (impostos dela) — não é dívida."}
      </p>
    </div>
  );
}
