import { PageHeader } from "@/components/PageHeader";
import { CondenseForm } from "@/components/CondenseForm";

export default function TempoUtilPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Cortar tempo útil" icon="✂️">
        Recebe o vídeo só com o jogo ativo — o tempo morto entre pontos é
        removido. Útil para rever o jogo mais depressa. Para a análise completa
        (heatmap, resultado, pancadas), usa o{" "}
        <span className="text-gray-300">Analisar jogo</span> na página inicial.
      </PageHeader>
      <div className="card p-6">
        <CondenseForm />
      </div>
    </div>
  );
}
