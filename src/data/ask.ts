import { supabase } from "@/lib/supabase";

export async function askApp(question: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ai-ask", {
    body: { question },
  });
  if (error) throw error instanceof Error ? error : new Error(String(error));
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String((data as { error: string }).error));
  }
  return (data as { answer: string }).answer;
}
