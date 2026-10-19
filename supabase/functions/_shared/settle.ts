// Cash/Revolut settlement matcher (spec 5.2): when a deposit/transfer from
// Joana reaches the Conta Casa, propose which "por_transferir" event payments
// it settles — oldest first, exact sum. Pure and testable.

export interface Pending {
  id: string;
  amount_cents: number;
  received_at: string | null;
}

/**
 * Pick the "por_transferir" payments a deposit of `amountCents` settles.
 * Prefers a single exact match, otherwise an oldest-first accumulation to the
 * exact amount. Returns [] when nothing adds up exactly.
 */
export function proposeSettlement(pending: Pending[], amountCents: number): Pending[] {
  if (amountCents <= 0) return [];
  const sorted = [...pending].sort((a, b) =>
    (a.received_at ?? "") < (b.received_at ?? "") ? -1 : 1,
  );

  const single = sorted.find((p) => p.amount_cents === amountCents);
  if (single) return [single];

  const picked: Pending[] = [];
  let sum = 0;
  for (const p of sorted) {
    if (sum + p.amount_cents > amountCents) continue;
    picked.push(p);
    sum += p.amount_cents;
    if (sum === amountCents) return picked;
  }
  return [];
}
