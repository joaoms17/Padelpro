import { describe, it, expect } from "vitest";
import { matchEntradaToEvents, type OpenEvent, type Entrada } from "./eventmatch";

const events: OpenEvent[] = [
  { id: "noiva", client_name: "Maria Silva", outstanding_cents: 20000 },
  { id: "convidada", client_name: "Ana Costa", outstanding_cents: 5000 },
];

const entrada = (over: Partial<Entrada>): Entrada => ({
  amount_cents: 5000,
  counterparty: "Ana Costa",
  description: "TRF",
  ...over,
});

describe("matchEntradaToEvents", () => {
  it("matches the full outstanding as 'restante' with name similarity", () => {
    const p = matchEntradaToEvents(entrada({ amount_cents: 5000, counterparty: "Ana Costa" }), events);
    expect(p?.eventId).toBe("convidada");
    expect(p?.kind).toBe("restante");
  });

  it("matches a partial amount as 'sinal'", () => {
    const p = matchEntradaToEvents(entrada({ amount_cents: 8000, counterparty: "Maria Silva" }), events);
    expect(p?.eventId).toBe("noiva");
    expect(p?.kind).toBe("sinal");
  });

  it("uses the MB WAY hint when the name is weak", () => {
    const p = matchEntradaToEvents(
      entrada({ amount_cents: 5000, counterparty: "MBWAY XYZ", description: "MB WAY 93..." }),
      events,
    );
    expect(p).not.toBeNull();
    expect(p?.amount_cents).toBe(5000);
  });

  it("ignores credits larger than the outstanding", () => {
    expect(matchEntradaToEvents(entrada({ amount_cents: 99999, counterparty: "Maria Silva" }), events)).toBeNull();
  });

  it("ignores debits and unknown senders", () => {
    expect(matchEntradaToEvents(entrada({ amount_cents: -5000 }), events)).toBeNull();
    expect(matchEntradaToEvents(entrada({ amount_cents: 5000, counterparty: "Desconhecido", description: "TRF" }), events)).toBeNull();
  });

  it("picks the best scoring event", () => {
    const p = matchEntradaToEvents(entrada({ amount_cents: 5000, counterparty: "Ana Costa" }), events);
    expect(p?.eventId).toBe("convidada"); // exact outstanding + name
  });
});
