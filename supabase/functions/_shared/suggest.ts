// Category suggestions — pure, shared by the app and the Edge Functions.
// A suggestion is a first guess the couple confirms with one tap: a known
// shop or service (Continente → Supermercado), an expected income (the NTT
// salary → Ordenado), or a transfer to/from one of them (→ Para o João).

/** Lowercase, no accents, letters and digits only: "TRF P/ JOÃO" → "trf p joao". */
export const plain = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The short category list (migration 0015), by its place in the app. */
export type Slot =
  | "ordenado"
  | "representacao"
  | "renda"
  | "joana"
  | "outras_entradas"
  | "prestacao"
  | "contas_casa"
  | "seguros"
  | "subscricoes"
  | "condominio"
  | "supermercado"
  | "restaurantes"
  | "uber_eats"
  | "compras_online"
  | "nutricao"
  | "carro"
  | "saude"
  | "maggie"
  | "viagens"
  | "casa_compras"
  | "trabalho_joana"
  | "poupanca";

/** How each slot is found among a household's categories: role, then names (new, then old). */
const SLOT_CATEGORY: Record<Slot, { grp: string; role?: string; names: string[] }> = {
  ordenado: { grp: "entrada", role: "salario", names: ["Ordenado João", "Salário e extras João"] },
  representacao: { grp: "entrada", role: "representacao", names: ["Despesas de representação"] },
  renda: { grp: "entrada", role: "renda", names: ["Renda casa arrendada"] },
  joana: { grp: "entrada", role: "eventos", names: ["Eventos Joana"] },
  outras_entradas: { grp: "entrada", names: ["Outras entradas"] },
  prestacao: { grp: "fixa", names: ["Prestação casa", "Crédito habitação e prestações"] },
  contas_casa: { grp: "fixa", names: ["Luz, água, gás e internet", "Luz"] },
  seguros: { grp: "fixa", names: ["Seguros"] },
  subscricoes: { grp: "fixa", names: ["Subscrições"] },
  condominio: { grp: "fixa", names: ["Condomínio, IMI e outras", "Condomínio"] },
  supermercado: { grp: "variavel", names: ["Supermercado"] },
  restaurantes: { grp: "variavel", names: ["Restaurantes e cafés", "Restaurantes e saídas"] },
  uber_eats: { grp: "variavel", names: ["Uber Eats e entregas"] },
  compras_online: { grp: "variavel", names: ["Compras online"] },
  nutricao: { grp: "variavel", names: ["Nutrição e suplementos"] },
  carro: { grp: "variavel", names: ["Carro e transportes", "Combustível e carregamentos"] },
  saude: { grp: "variavel", names: ["Saúde e farmácia"] },
  maggie: { grp: "variavel", names: ["Maggie"] },
  viagens: { grp: "variavel", names: ["Viagens e lazer", "Viagens"] },
  casa_compras: { grp: "variavel", names: ["Casa e outras compras", "Outras variáveis"] },
  trabalho_joana: { grp: "atividade", names: ["Trabalho da Joana", "Material"] },
  poupanca: { grp: "interna", names: ["Poupança", "Entre contas"] },
};

/**
 * Known shops and services → slot. Each key is matched as whole words in the
 * plain description ("pingo doce"), or anywhere when it starts with "~"
 * ("~ubereats" also finds "UBEREATSPT"). First match wins, so the specific
 * ones (uber eats, amazon prime, galp energia) come before the general ones.
 */
export const MERCHANTS: [string[], Slot][] = [
  // Venues and car charging named after a telecom/energy brand
  [["altice arena", "meo arena", "meo kalorama", "~kalorama", "nos alive", "~nosalive", "super bock arena"], "viagens"],
  [["edp charge", "~edpcharge", "galp electric", "~galpelectric"], "carro"],
  // Delivery before rides and restaurants
  [["uber eats", "~ubereats", "glovo", "bolt food", "too good to go", "takeaway"], "uber_eats"],
  // Subscriptions before online shops (Amazon Prime) and sports shops
  [
    [
      "netflix", "spotify", "disney", "hbo", "max com", "prime video", "~primevideo", "amazon prime", "~amazonprime",
      "amzn prime", "~amznprime",
      "apple com bill", "~applecombill", "itunes", "icloud", "google one", "google storage", "youtube premium",
      "sporting clube", "sporting cp", "quotas sporting", "quota sporting", "sporting quotas", "sport tv", "dazn", "eleven sports",
      "chatgpt", "openai", "microsoft 365", "adobe", "audible", "kindle unlimited", "fitness hut", "holmes place",
      "solinca", "go fit", "virgin active", "ginasio",
    ],
    "subscricoes",
  ],
  // Energy, water, telecom before fuel (Galp sells both)
  [
    [
      "edp comercial", "edp", "galp energia", "galp power", "galp gas", "endesa", "iberdrola", "goldenergy", "luzboa",
      "su eletricidade", "coopernico", "epal", "aguas de", "aguas do", "smas", "indaqua", "simar", "be water",
      "meo", "nos comunicacoes", "nos sgps", "vodafone", "nowo", "digi portugal", "altice",
    ],
    "contas_casa",
  ],
  [
    [
      "seguro", "seguros", "fidelidade", "ageas", "allianz", "tranquilidade", "generali", "zurich", "liberty",
      "ok teleseguros", "logo seguros", "una seguros", "mapfre", "medis", "multicare", "advancecare", "real vida",
      "victoria seguros", "caravela", "lusitania",
    ],
    "seguros",
  ],
  [["prestacao", "prest emprestimo", "emprestimo", "credito habitacao", "cred habitacao", "juros emprestimo"], "prestacao"],
  [["condominio", "imi", "iuc", "imposto do selo", "comissao", "comissoes", "manutencao de conta", "manutencao conta"], "condominio"],
  [
    [
      "continente", "pingo doce", "~pingodoce", "lidl", "aldi", "mercadona", "auchan", "intermarche", "minipreco",
      "mini preco", "spar", "coviran", "meu super", "amanhecer", "recheio", "makro", "froiz", "apolonia",
      "supermercado", "mercearia", "talho", "frutaria",
    ],
    "supermercado",
  ],
  [
    [
      "prozis", "myprotein", "my protein", "hsnstore", "hsn store", "bulk", "nutrition", "nutritions", "gold nutrition",
      "celeiro", "go natural",
    ],
    "nutricao",
  ],
  [
    [
      "amazon", "~amzn", "temu", "shein", "aliexpress", "ali express", "wish com", "zalando", "ebay", "vinted",
      "kuantokusta", "olx",
    ],
    "compras_online",
  ],
  [
    [
      "galp", "repsol", "cepsa", "moeve", "prio", "shell", "bp", "via verde", "brisa auto estradas", "brisa autoestradas",
      "ascendi", "portagem", "portagens", "emel", "saba", "empark", "parque estacionamento", "parking", "estacionamento",
      "uber", "bolt", "free now", "cabify", "cp comboios", "comboios de portugal", "metropolitano", "metro lisboa",
      "metro do porto", "carris", "fertagus", "navegante", "gira", "oficina auto", "norauto", "midas", "carglass",
      "pneus", "miio", "mobi e", "ionity", "electrify",
    ],
    "carro",
  ],
  // Vets before health ("Hospital Veterinário", "Clínica Veterinária")
  [["veterinario", "veterinaria", "~veterinar", "zooplus", "kiwoko", "tiendanimal", "animalife", "maggie"], "maggie"],
  [
    [
      "farmacia", "wells", "cuf", "hospital", "clinica", "luz saude", "lusiadas", "trofa saude", "dentista",
      "dentaria", "medico", "optica", "opticas", "multiopticas", "laboratorio", "germano de sousa", "unilabs",
      "synlab", "joaquim chaves", "fisioterapia",
    ],
    "saude",
  ],
  [
    [
      "booking", "airbnb", "hotel", "hoteis", "hostel", "tap air", "~flytap", "ryanair", "easyjet", "vueling",
      "transavia", "expedia", "edreams", "trivago", "cinema", "cinemas", "uci", "ticketline", "blueticket",
      "ticketmaster", "bol pt", "teatro", "museu", "concerto", "festival", "playstation", "steam", "nintendo",
    ],
    "viagens",
  ],
  [
    [
      "restaurante", "rest", "cafe", "cafetaria", "pastelaria", "padaria", "snack bar", "snack", "tasca",
      "marisqueira", "churrasqueira", "pizzaria", "sushi", "mcdonalds", "mc donalds", "burger king", "kfc",
      "telepizza", "pizza hut", "h3", "starbucks", "padaria portuguesa", "cervejaria", "taberna", "bar",
    ],
    "restaurantes",
  ],
  [
    [
      "ikea", "leroy merlin", "aki", "bricomarche", "maxmat", "conforama", "jysk", "worten", "fnac", "radio popular",
      "staples", "primark", "zara", "hm", "h m", "pull bear", "bershka", "mango", "decathlon", "sport zone",
      "el corte ingles", "action", "flying tiger", "sephora", "perfumes companhia", "cabeleireiro", "barbearia",
    ],
    "casa_compras",
  ],
];

/** The shop/service slot of a description, if it is a known one. */
export function merchantSlot(desc: string | null | undefined): Slot | null {
  const p = plain(desc);
  if (!p) return null;
  const padded = ` ${p} `;
  const squashed = p.replace(/ /g, "");
  // Keep the list order: the first group with any match wins.
  for (const [keys, slot] of MERCHANTS) {
    for (const k of keys) {
      if (k.startsWith("~") ? squashed.includes(k.slice(1)) : padded.includes(` ${k} `)) return slot;
    }
  }
  return null;
}

export interface SuggestCategoryRow {
  id: string;
  name: string;
  grp: string;
  sort?: number | null;
  system_role?: string | null;
  archived?: boolean | null;
}

/** The household's category for a slot (null when it has none). */
export function slotCategory(slot: Slot, categories: SuggestCategoryRow[]): SuggestCategoryRow | null {
  const spec = SLOT_CATEGORY[slot];
  const live = categories.filter((c) => !c.archived);
  if (spec.role) {
    const byRole = live.find((c) => c.system_role === spec.role);
    if (byRole) return byRole;
  }
  for (const n of spec.names) {
    const hit = live.find((c) => c.grp === spec.grp && plain(c.name) === plain(n));
    if (hit) return hit;
  }
  return null;
}

export interface SuggestMember {
  id: string;
  display_name: string | null;
}

/**
 * Who a description names, longest name first so "joana" is never taken for
 * "joao" (or vice-versa). Whole words only.
 */
export function makeNameFinder(members: SuggestMember[]): (desc: string | null | undefined) => string | null {
  const names = members
    .map((m) => ({ id: m.id, key: plain(m.display_name) }))
    .filter((n) => n.key.length >= 3)
    .sort((a, b) => b.key.length - a.key.length);
  return (desc) => {
    const words = ` ${plain(desc)} `;
    return names.find((n) => words.includes(` ${n.key} `))?.id ?? null;
  };
}

/** A member's own category in "Para vocês" (its name has the person's name). */
export function memberCategory(
  memberId: string,
  members: SuggestMember[],
  categories: SuggestCategoryRow[],
): SuggestCategoryRow | null {
  const m = members.find((x) => x.id === memberId);
  const key = plain(m?.display_name);
  if (key.length < 3) return null;
  return (
    categories
      .filter((c) => !c.archived && c.grp === "mesada" && plain(c.name).split(" ").includes(key))
      .sort((a, b) => Number(b.system_role === "mesada") - Number(a.system_role === "mesada") || (a.sort ?? 0) - (b.sort ?? 0))[0] ?? null
  );
}

export interface SuggestIncome {
  match_text: string | null;
  amount_cents: number;
  parts: number;
  /** salario | representacao | renda | outra; unset → guessed from the label. */
  kind?: string | null;
  label?: string | null;
  active: boolean;
}

export type IncomeKind = "salario" | "representacao" | "renda" | "outra";

/** What an income is from its name ("Ordenado Joao" → salario). */
export function guessIncomeKind(label: string | null | undefined): IncomeKind {
  const p = plain(label);
  if (/\b(ordenado|salario|vencimento)\b/.test(p)) return "salario";
  if (/\b(despesas?|representacao)\b/.test(p)) return "representacao";
  if (/\brenda\b/.test(p)) return "renda";
  return "outra";
}

/** The income's kind: as stored, or guessed from its name when not set. */
export function kindOf(i: Pick<SuggestIncome, "kind" | "label">): IncomeKind {
  const k = i.kind;
  return k === "salario" || k === "representacao" || k === "renda" || k === "outra" ? k : guessIncomeKind(i.label);
}

/** Does the description carry an income's keyword (same test as the income form's preview)? */
export function hasIncomeKeyword(desc: string | null | undefined, inc: Pick<SuggestIncome, "match_text" | "active">): boolean {
  const kw = plain(inc.match_text);
  return inc.active && kw.length >= 3 && plain(desc).includes(kw);
}

const INCOME_SLOT: Record<string, Slot> = {
  salario: "ordenado",
  representacao: "representacao",
  renda: "renda",
  outra: "outras_entradas",
};

/**
 * The expected income a credit is, by keyword and size: the one whose part is
 * closest to the amount (half to double of it). Two or three parts at once
 * (a late batch) also fit, but a direct fit on another income with the same
 * keyword wins. A salary that came with a prémio is still the salary.
 */
export function incomeFor(
  amountCents: number,
  desc: string | null | undefined,
  incomes: SuggestIncome[],
): SuggestIncome | null {
  if (amountCents <= 0) return null;
  let best: { inc: SuggestIncome; gap: number } | null = null;
  for (const inc of incomes) {
    if (!hasIncomeKeyword(desc, inc)) continue;
    const part = inc.amount_cents / Math.max(1, inc.parts);
    if (part <= 0) continue;
    const direct = Math.abs(Math.log(amountCents / part));
    let gap = direct <= Math.log(2) ? direct : Infinity;
    for (const k of [2, 3]) {
      const batch = Math.abs(Math.log(amountCents / (part * k)));
      if (batch <= Math.log(1.3)) gap = Math.min(gap, batch + 0.15);
    }
    if (kindOf(inc) === "salario" && amountCents >= part) gap = Math.min(gap, 0.05);
    if (gap === Infinity) continue;
    if (!best || gap < best.gap) best = { inc, gap };
  }
  return best?.inc ?? null;
}

export type SuggestReason = "loja" | "entrada" | "pessoa";

export interface Suggestion {
  category_id: string;
  reason: SuggestReason;
}

export interface SuggestContext {
  categories: SuggestCategoryRow[];
  members: SuggestMember[];
  incomes: SuggestIncome[];
}

/** First guess for an uncategorized movement (null when there is none). */
export function makeSuggester(ctx: SuggestContext): (tx: { amount_cents: number; description_raw: string | null }) => Suggestion | null {
  const byName = makeNameFinder(ctx.members);
  const joana = ctx.members.find((m) => plain(m.display_name) === "joana")?.id ?? null;
  const pick = (slot: Slot, reason: SuggestReason): Suggestion | null => {
    const c = slotCategory(slot, ctx.categories);
    return c ? { category_id: c.id, reason } : null;
  };
  return (tx) => {
    if (tx.amount_cents > 0) {
      const inc = incomeFor(tx.amount_cents, tx.description_raw, ctx.incomes);
      if (inc) return pick(INCOME_SLOT[kindOf(inc)], "entrada");
      // An income's keyword with an unusual amount (a catch-up, a partial
      // refund of expenses): not a person's money back — leave it to them.
      if (ctx.incomes.some((i) => hasIncomeKeyword(tx.description_raw, i))) return null;
    }
    // Joana's transfers in are her events money; any other credit from one
    // of you is money given back; a debit is money for that person.
    const person = (who: string): Suggestion | null => {
      if (tx.amount_cents > 0 && who === joana) return pick("joana", "pessoa");
      const c = memberCategory(who, ctx.members, ctx.categories);
      return c ? { category_id: c.id, reason: "pessoa" } : null;
    };
    const who = byName(tx.description_raw);
    // A transfer naming one of you is about that person; a shop that happens
    // to carry a name ("Galp S. João") is still the shop.
    if (who && isTransfer(tx.description_raw)) return person(who);
    const slot = merchantSlot(tx.description_raw);
    // A refund goes back into the shop's category.
    return slot ? pick(slot, "loja") : null;
  };
}

/** A bank transfer or MB WAY (as opposed to a card purchase). */
export function isTransfer(desc: string | null | undefined): boolean {
  const p = ` ${plain(desc)} `;
  return [" trf ", " transf ", " transferencia ", " mb way ", " mbway ", " sepa ", " imed "].some((k) => p.includes(k));
}
