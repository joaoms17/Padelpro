/** Text for anything thrown: an Error, or Supabase's plain `{ message }` error objects. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  const m = (e as { message?: unknown } | null)?.message;
  if (typeof m === "string" && m) return m;
  return String(e);
}
