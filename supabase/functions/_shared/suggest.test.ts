import { describe, it, expect } from "vitest";
import { guessIncomeKind, incomeFor, kindOf, makeSuggester, merchantSlot, plain, slotCategory, type SuggestCategoryRow } from "./suggest";

const cats: SuggestCategoryRow[] = [
  ["entrada", "Ordenado João", "salario"],
  ["entrada", "Despesas de representação", "representacao"],
  ["entrada", "Renda casa arrendada", "renda"],
  ["entrada", "Eventos Joana", "eventos"],
  ["entrada", "Outras entradas", null],
  ["fixa", "Prestação casa", null],
  ["fixa", "Luz, água, gás e internet", null],
  ["fixa", "Seguros", null],
  ["fixa", "Subscrições", null],
  ["variavel", "Supermercado", null],
  ["variavel", "Restaurantes e cafés", null],
  ["variavel", "Uber Eats e entregas", null],
  ["variavel", "Compras online", null],
  ["variavel", "Nutrição e suplementos", null],
  ["variavel", "Carro e transportes", null],
  ["variavel", "Viagens e lazer", null],
  ["mesada", "Para o João", "mesada"],
  ["mesada", "Para a Joana", "mesada"],
  ["interna", "Poupança", null],
].map(([grp, name, role], i) => ({ id: `c${i}`, grp: grp as string, name: name as string, system_role: role, sort: i }));
const nameOf = (id: string | undefined) => cats.find((c) => c.id === id)?.name;

const members = [
  { id: "mj", display_name: "João" },
  { id: "ma", display_name: "Joana" },
];
const incomes = [
  { match_text: "ntt data", amount_cents: 195157, parts: 1, kind: "salario", active: true },
  { match_text: "despesas joao", amount_cents: 54160, parts: 1, kind: "representacao", active: true },
  { match_text: "renda", amount_cents: 120000, parts: 1, kind: "renda", active: true },
];
const suggest = makeSuggester({ categories: cats, members, incomes });
const s = (cents: number, desc: string) => nameOf(suggest({ amount_cents: cents, description_raw: desc })?.category_id);

describe("merchantSlot", () => {
  it("knows the usual shops and services", () => {
    expect(merchantSlot("COMPRA 4512 CONTINENTE BOM DIA LISBOA")).toBe("supermercado");
    expect(merchantSlot("COMPRA PINGODOCE ALVALADE")).toBe("supermercado");
    expect(merchantSlot("UBER *EATS PENDING")).toBe("uber_eats");
    expect(merchantSlot("UBER TRIP HELP.UBER.COM")).toBe("carro");
    expect(merchantSlot("Estrang Www Amazon Nk8yt9dq4")).toBe("compras_online");
    expect(merchantSlot("AMAZON PRIME PT")).toBe("subscricoes");
    expect(merchantSlot("NETFLIX.COM")).toBe("subscricoes");
    expect(merchantSlot("DD SPORTING CLUBE DE PORTUGAL QUOTAS")).toBe("subscricoes");
    expect(merchantSlot("PROZIS.COM")).toBe("nutricao");
    expect(merchantSlot("TEMU.COM DUBLIN")).toBe("compras_online");
    expect(merchantSlot("GALP ENERGIA SA DD")).toBe("contas_casa");
    expect(merchantSlot("GALP AREIAS S JOAO")).toBe("carro");
    expect(merchantSlot("DEB DIR EDP COMERCIAL")).toBe("contas_casa");
    expect(merchantSlot("FIDELIDADE COMPANHIA DE SEGUROS")).toBe("seguros");
    expect(merchantSlot("FARMACIA ESTACAO")).toBe("saude");
    expect(merchantSlot("BOOKING.COM HOTEL")).toBe("viagens");
  });
  it("vets, Prime billed as AMZN, venues and chargers named after a brand", () => {
    expect(merchantSlot("COMPRA 4512 HOSPITAL VETERINARIO DO RESTELO")).toBe("maggie");
    expect(merchantSlot("COMPRA 4512 CLINICA VETERINARIA DE ALVALADE")).toBe("maggie");
    expect(merchantSlot("AMZNPrime ES*AB12CD34")).toBe("subscricoes");
    expect(merchantSlot("COMPRA RESTAURANTE BRISA DO MAR")).toBe("restaurantes");
    expect(merchantSlot("COMPRA ALTICE ARENA LISBOA")).toBe("viagens");
    expect(merchantSlot("COMPRA MEO KALORAMA")).toBe("viagens");
    expect(merchantSlot("EDP CHARGE LISBOA")).toBe("carro");
    expect(merchantSlot("VIA VERDE PORTUGAL")).toBe("carro");
  });
  it("leaves unknown names and look-alike words alone", () => {
    expect(merchantSlot("MB WAY 912345678")).toBeNull();
    expect(merchantSlot("TRF RESTANTE SINAL")).toBeNull();
    expect(merchantSlot("")).toBeNull();
  });
});

describe("slotCategory", () => {
  it("finds by role first, then the new or old name", () => {
    expect(slotCategory("ordenado", cats)?.name).toBe("Ordenado João");
    expect(slotCategory("supermercado", [{ id: "x", grp: "variavel", name: "SUPERMERCADO" }])?.id).toBe("x");
    expect(slotCategory("restaurantes", [{ id: "y", grp: "variavel", name: "Restaurantes e saídas" }])?.id).toBe("y");
    expect(slotCategory("maggie", cats)).toBeNull();
  });
});

describe("incomeFor", () => {
  it("picks the income by keyword and closest size, batches included", () => {
    expect(incomeFor(195157, "Ordenado de Ntt Data Portugal s a", incomes)?.kind).toBe("salario");
    expect(incomeFor(764388, "Ordenado de Ntt Data Portugal s a", incomes)?.kind).toBe("salario"); // with prémio
    expect(incomeFor(54160, "TRF DESPESAS JOAO", incomes)?.kind).toBe("representacao");
    expect(incomeFor(108320, "TRF DESPESAS JOAO", incomes)?.kind).toBe("representacao"); // two months at once
    expect(incomeFor(120000, "TRF RENDA OUTUBRO", incomes)?.kind).toBe("renda");
    expect(incomeFor(3000, "TRF RENDA OUTUBRO", incomes)).toBeNull(); // too small to be it
    expect(incomeFor(-54160, "TRF DESPESAS JOAO", incomes)).toBeNull();
  });
  it("same keyword for salary and representação: a direct fit beats a batch", () => {
    const shared = [
      { match_text: "ntt data", amount_cents: 195157, parts: 1, kind: "salario", active: true },
      { match_text: "ntt data", amount_cents: 54160, parts: 1, kind: "representacao", active: true },
    ];
    expect(incomeFor(170000, "Ordenado de Ntt Data", shared)?.kind).toBe("salario");
    expect(incomeFor(108320, "TRF NTT DATA", shared)?.kind).toBe("representacao");
    expect(incomeFor(54160, "TRF NTT DATA", shared)?.kind).toBe("representacao");
  });
  it("the keyword is matched like the income form does (part of a word)", () => {
    expect(incomeFor(54160, "TRF DESPESAS JOAO", [{ match_text: "despesa", amount_cents: 54160, parts: 1, active: true, label: "Despesas" }])?.match_text).toBe("despesa");
  });
  it("an income's kind is guessed from its name when not set", () => {
    expect(guessIncomeKind("Ordenado Joao")).toBe("salario");
    expect(guessIncomeKind("Despesas Joao")).toBe("representacao");
    expect(guessIncomeKind("Renda Casa")).toBe("renda");
    expect(guessIncomeKind("Bónus")).toBe("outra");
    expect(kindOf({ kind: null, label: "Ordenado novo" })).toBe("salario");
    expect(kindOf({ kind: "outra", label: "Ordenado novo" })).toBe("outra");
  });
});

describe("makeSuggester", () => {
  it("incomes, people and shops", () => {
    expect(s(195157, "Ordenado de Ntt Data Portugal s a")).toBe("Ordenado João");
    expect(s(54160, "TRF DESPESAS JOAO")).toBe("Despesas de representação"); // keyword beats the name
    expect(s(50000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672")).toBe("Eventos Joana");
    expect(s(-50000, "TRF P/ JOAO M SILVA")).toBe("Para o João");
    expect(s(-20000, "MB WAY P/ JOANA")).toBe("Para a Joana");
    expect(s(20000, "TRF DE JOAO M SILVA")).toBe("Para o João"); // money given back
    expect(s(-8450, "COMPRA CONTINENTE")).toBe("Supermercado");
    expect(s(1299, "DEVOLUCAO AMAZON")).toBe("Compras online"); // a refund goes back to the shop's category
    expect(s(-1000, "MB WAY 912345678")).toBeUndefined();
    expect(s(-4500, "COMPRA GALP AREIAS S JOAO")).toBe("Carro e transportes"); // a place, not a person
    expect(s(-1200, "COMPRA 4512 CANTINHO DO JOAO LISBOA")).toBeUndefined(); // a card purchase is never a person
    expect(s(216640, "TRF DESPESAS JOAO")).toBeUndefined(); // income keyword, unusual amount: not money given back
  });
  it("plain() drops accents and symbols", () => {
    expect(plain("TRF P/ JOÃO")).toBe("trf p joao");
  });
});
