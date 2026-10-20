import { invokeFn } from "@/lib/invoke";

export async function askApp(question: string): Promise<string> {
  const data = await invokeFn<{ answer: string }>("ai-ask", { question });
  return data.answer;
}
