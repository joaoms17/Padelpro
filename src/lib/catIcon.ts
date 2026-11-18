// A small picture for each category, so a list is read at a glance.
const ICONS: [RegExp, string][] = [
  [/supermercado|mercearia/, "🛒"],
  [/uber eats|entregas|takeaway/, "🛵"],
  [/restaurante|cafe|saidas/, "🍽️"],
  [/online/, "📦"],
  [/nutricao|suplemento/, "🥗"],
  [/carro|transporte|combustivel|portagen/, "🚗"],
  [/saude|farmacia/, "💊"],
  [/maggie|animal|\bcao\b|\bgato\b|veterin/, "🐶"],
  [/viagen|lazer|ferias/, "✈️"],
  [/trabalho|material|atividade/, "💇"],
  [/prestacao|credito|renda/, "🏠"],
  [/luz|agua|gas|internet|telemovel/, "💡"],
  [/seguro/, "🛡️"],
  [/subscri/, "📺"],
  [/condominio|imi|imposto/, "🏢"],
  [/poupanca/, "🐷"],
  [/roupa/, "👕"],
  [/prenda/, "🎁"],
  [/casa|compras/, "🛍️"],
];

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** The category's own icon when it has one; otherwise one guessed from its name. */
export function catIcon(name: string, icon?: string | null): string {
  if (icon && icon.trim()) return icon.trim();
  const p = plain(name);
  return ICONS.find(([re]) => re.test(p))?.[1] ?? "•";
}
