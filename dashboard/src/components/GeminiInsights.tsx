import type { ClipReport } from "@/lib/api";

type GeminiMeta = {
  tactics: string;
  summary: string;
  dominant_side: string | null;
  n_rallies: number | null;
  n_strokes: number;
};

type ShotLite = { type?: string; outcome?: string };

const SIDE_LABEL: Record<string, string> = {
  near: "lado próximo domina a rede",
  far: "lado longe domina a rede",
  balanced: "equilíbrio na rede",
};

const OUTCOME_LABEL: Record<string, string> = {
  winner: "Winners",
  unforced_error: "Erros não forçados",
  forced_error: "Erros forçados",
  let: "Lets",
};

/**
 * The semantic layer of an analysis — tipos de pancada, tática e resultados —
 * produzidos pelo Gemini. Mostra-se em todos os ecrãs de relatório (upload e
 * jogo guardado) para a análise não desaparecer depois do upload.
 */
export function GeminiInsights({ gemini, shots }: { gemini: GeminiMeta; shots?: ShotLite[] }) {
  const outcomes: Record<string, number> = {};
  for (const s of shots ?? []) {
    if (s.outcome && s.outcome !== "continuation") {
      outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
    }
  }
  const outcomeEntries = Object.entries(outcomes).filter(([, n]) => n > 0);

  return (
    <div className="bg-blue-950/40 border border-blue-800/50 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-blue-300">🤖 Análise IA (Gemini)</span>
        <span className="text-xs text-blue-700">
          {gemini.n_strokes} pancadas
          {gemini.n_rallies != null ? ` · ${gemini.n_rallies} rallies` : ""}
          {gemini.dominant_side ? ` · ${SIDE_LABEL[gemini.dominant_side] ?? gemini.dominant_side}` : ""}
        </span>
      </div>
      {gemini.summary && <p className="text-sm text-gray-300 font-medium">{gemini.summary}</p>}
      {gemini.tactics && <p className="text-sm text-gray-400">{gemini.tactics}</p>}
      {outcomeEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {outcomeEntries.map(([k, n]) => (
            <span
              key={k}
              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                k === "winner"
                  ? "border-emerald-600 text-emerald-300"
                  : "border-gray-700 text-gray-400"
              }`}
            >
              {OUTCOME_LABEL[k] ?? k}: {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Convenience: pull the Gemini block straight from a ClipReport when present. */
export function ClipGeminiInsights({ report }: { report: ClipReport }) {
  if (!report.gemini) return null;
  return <GeminiInsights gemini={report.gemini} shots={report.shots} />;
}
