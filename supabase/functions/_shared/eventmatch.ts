// Match an incoming bank credit to an open event payment (spec 5.2):
// "a app tenta casar cada entrada com pagamentos em aberto (valor igual ao
// sinal ou ao restante, nome do ordenante parecido com o cliente, texto
// 'MB WAY')". Pure and testable; used by the reconcile step in eb-sync.
import { merchantSimilarity } from "./match.ts";

export interface OpenEvent {
  id: string;
  client_name: string | null;
  outstanding_cents: number; // how much is still owed on the event
}

export interface Entrada {
  amount_cents: number; // credit, positive
  counterparty: string | null; // ordinante
  description: string | null; // remittance (may contain "MB WAY")
}

export interface EventProposal {
  eventId: string;
  kind: "sinal" | "restante";
  amount_cents: number;
  score: number; // 0..~1.7
}

const NAME_THRESHOLD = 0.4;
const MIN_SCORE = 0.4;

export function matchEntradaToEvents(
  entrada: Entrada,
  openEvents: OpenEvent[],
): EventProposal | null {
  if (entrada.amount_cents <= 0) return null;
  const amount = entrada.amount_cents;
  const isMbway = /mb\s?way/i.test(entrada.description ?? "");

  let best: EventProposal | null = null;
  for (const ev of openEvents) {
    if (ev.outstanding_cents <= 0) continue;
    if (amount > ev.outstanding_cents) continue; // can't pay more than owed

    const nameSim = merchantSimilarity(entrada.counterparty ?? "", ev.client_name ?? "");
    if (nameSim < NAME_THRESHOLD && !isMbway) continue; // need a name or MB WAY hint

    const exact = amount === ev.outstanding_cents;
    const score = nameSim + (exact ? 0.5 : 0) + (isMbway ? 0.2 : 0);
    if (score < MIN_SCORE) continue;

    const proposal: EventProposal = {
      eventId: ev.id,
      kind: exact ? "restante" : "sinal",
      amount_cents: amount,
      score,
    };
    if (!best || proposal.score > best.score) best = proposal;
  }
  return best;
}
