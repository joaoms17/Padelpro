import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui";
import { askApp } from "@/data/ask";

interface Msg {
  role: "user" | "app";
  text: string;
}

const SUGGESTIONS = [
  "Quanto gastámos em restaurantes este ano?",
  "Qual foi a sobra do mês passado?",
  "Quanto falta receber dos eventos deste mês?",
  "Como está a almofada?",
];

export function Pergunta() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const answer = await askApp(question);
      setMessages((m) => [...m, { role: "app", text: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "app", text: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-10rem)]">
      <PageHeader title="Pergunta à app" subtitle="Pergunta sobre as vossas contas." />

      <div className="flex-1 space-y-3 py-5">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-tinta/50 dark:text-creme/50">Experimenta:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="card p-3 w-full text-left text-sm active:scale-[0.99] transition-transform"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-terracota text-creme rounded-br-sm"
                    : "card rounded-bl-sm"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="card rounded-2xl rounded-bl-sm px-4 py-2.5">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-tinta/30 dark:bg-creme/30 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-tinta/30 dark:bg-creme/30 animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-tinta/30 dark:bg-creme/30 animate-bounce [animation-delay:0.3s]" />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="sticky bottom-20 flex gap-2 bg-creme/80 dark:bg-tinta/80 backdrop-blur py-2"
      >
        <input
          className="input flex-1"
          placeholder="Escreve a tua pergunta…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-primary px-4" disabled={busy || !input.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}
