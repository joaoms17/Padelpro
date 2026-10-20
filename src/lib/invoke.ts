import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Calls an Edge Function and surfaces its own error message (e.g.
 * "Santander não encontrado") instead of supabase-js's generic
 * "Edge Function returned a non-2xx status code".
 */
export async function invokeFn<T>(
  name: string,
  body: unknown,
  opts: { allowPartial?: boolean } = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as object });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const payload = await res.json().catch(() => null) as
        | { error?: string; message?: string }
        | null;
      if (res.status === 404 && !payload?.error) {
        msg = `A função "${name}" ainda não está instalada no servidor.`;
      } else if (payload?.error || payload?.message) {
        msg = String(payload.error ?? payload.message);
      }
    }
    throw new Error(msg);
  }
  // allowPartial: a 200 that carries `error` (e.g. one bank account failed,
  // the others synced) is returned to the caller instead of thrown.
  if (!opts.allowPartial && data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String((data as { error: string }).error));
  }
  return data as T;
}
