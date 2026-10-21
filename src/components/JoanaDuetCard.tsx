import { useState } from "react";
import type { DuetMonth } from "@/data/duet";
import { saveJoanaWaiver, useJoanaWaivers } from "@/data/incomes";
import { errorMessage } from "@/lib/errors";
import { joanaGap } from "@/lib/meses";
import { Eur } from "./kit";

const faint = "text-tinta/50 dark:text-creme/50";

/**
 * Joana's month, from November: what she marked as received on Duet against
 * what reached the house account. She puts in everything she receives, so
 * the difference is still to arrive — unless it is marked as not owed
 * ("Não é dívida", kept per month). Hidden while Duet is not set up.
 */
export function JoanaDuetCard({
  month,
  bankCents,
  duet,
  householdId,
}: {
  month: string;
  bankCents: number;
  /** The month on Duet (null while loading). */
  duet: DuetMonth | null;
  householdId: string;
}) {
  const { waivers, reload } = useJoanaWaivers(householdId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!duet) return <p className={`text-xs ${faint} py-1`}>A ver a Duet…</p>;
  if (!duet.configured) {
    return duet.error ? <p className={`text-xs ${faint} py-1`}>Não consegui ver a Duet: {duet.error}</p> : null;
  }

  const gap = joanaGap(duet.cents, bankCents, waivers?.[month] ?? 0);

  async function waive(cents: number | null) {
    setBusy(true);
    setError(null);
    try {
      await saveJoanaWaiver(householdId, month, cents);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-areia/40 dark:bg-white/5 px-3 py-2.5 text-sm space-y-1.5">
      <p>
        Recebeu na Duet <Eur cents={duet.cents} className="font-medium" /> · chegou à conta <Eur cents={bankCents} className="font-medium" />
      </p>
      {duet.count === 0 ? (
        <p className={`text-xs ${faint}`}>Nada marcado como recebido na Duet este mês.</p>
      ) : !waivers ? null : gap.missing > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 font-medium text-terracota dark:text-orange-300">
            Faltam <Eur cents={gap.missing} /> chegar à conta
          </p>
          <button
            className="shrink-0 rounded-full border border-areia dark:border-white/10 px-3 py-1 text-xs active:opacity-60 disabled:opacity-50"
            disabled={busy}
            onClick={() => void waive(gap.gap)}
          >
            Não é dívida
          </button>
        </div>
      ) : gap.waived === 0 ? (
        <p className="font-medium text-petroleo dark:text-teal-300">✓ Chegou tudo</p>
      ) : null}
      {waivers && gap.waived > 0 && (
        <div className={`flex items-center justify-between gap-3 text-xs ${faint}`}>
          <span className="min-w-0">
            Diferença de <Eur cents={gap.waived} /> marcada como não sendo dívida
          </span>
          <button
            className="shrink-0 font-medium text-petroleo dark:text-teal-300 active:opacity-60 disabled:opacity-50"
            disabled={busy}
            onClick={() => void waive(null)}
          >
            Desfazer
          </button>
        </div>
      )}
      {error && <p className="text-xs text-terracota dark:text-orange-300">Não consegui guardar: {error}</p>}
    </div>
  );
}
