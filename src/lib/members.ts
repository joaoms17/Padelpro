// This app is for exactly two people. The two allowed emails → names come from
// env vars so the personal emails stay out of the public source. Set in Vercel:
//   VITE_JOAO_EMAIL=joao.ms17@hotmail.com
//   VITE_JOANA_EMAIL=joanacmoraes@hotmail.com

const MAP: Record<string, string> = {};
const joao = import.meta.env.VITE_JOAO_EMAIL?.toLowerCase().trim();
const joana = import.meta.env.VITE_JOANA_EMAIL?.toLowerCase().trim();
if (joao) MAP[joao] = "João";
if (joana) MAP[joana] = "Joana";

/** True when the two allowed emails are configured. */
export const allowlistConfigured = Object.keys(MAP).length > 0;

/** The fixed name for an email, or null if it isn't one of the two. */
export function nameForEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return MAP[email.toLowerCase().trim()] ?? null;
}
