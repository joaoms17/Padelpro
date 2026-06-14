import Link from "next/link";
import { ReportUploadForm } from "@/components/ReportUploadForm";

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero + main flow */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        <div className="lg:col-span-2 space-y-4 pt-2">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Analisa o teu jogo de{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-info">
              padel
            </span>
          </h1>
          <p className="text-gray-400 leading-relaxed">
            Carrega o vídeo (ou cola um link) e a IA lê o jogo todo: onde cada
            jogador esteve (<span className="text-gray-200">heatmap</span>), o{" "}
            <span className="text-gray-200">resultado</span>, as{" "}
            <span className="text-gray-200">pancadas</span> de cada um, as{" "}
            <span className="text-gray-200">formações</span> e exemplos de frames.
          </p>
          <ol className="text-sm text-gray-500 space-y-2">
            <li className="flex gap-2"><span className="text-brand font-bold">1.</span> Filma o jogo de trás do campo (o telemóvel chega)</li>
            <li className="flex gap-2"><span className="text-brand font-bold">2.</span> Carrega o vídeo aqui ao lado</li>
            <li className="flex gap-2"><span className="text-brand font-bold">3.</span> Vê o relatório e contribui para treinar o nosso modelo</li>
          </ol>
          <Link href="/ajuda" className="inline-block text-sm text-brand hover:underline">
            Como funciona, passo a passo →
          </Link>
        </div>

        <div className="lg:col-span-3 card p-6">
          <h2 className="text-lg font-semibold text-white mb-1">⚡ Analisar jogo</h2>
          <p className="text-sm text-gray-500 mb-4">
            A análise corre no Gemini e demora alguns minutos. Recebes um relatório completo.
          </p>
          <ReportUploadForm />
        </div>
      </section>

      {/* Two parts of the product, stated clearly */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="tag-insight mb-2">Parte 1</div>
          <h3 className="font-semibold text-white mb-1">Relatório do jogo</h3>
          <p className="text-sm text-gray-500">
            A leitura da IA sobre o vídeo todo — heatmap, resultado, pancadas por
            jogador e por tipo, % de tempo em cada formação e frames de exemplo.
          </p>
        </div>
        <div className="card p-5">
          <div className="tag-insight mb-2">Parte 2</div>
          <h3 className="font-semibold text-white mb-1">Treinar o nosso modelo</h3>
          <p className="text-sm text-gray-500">
            Cada relatório e cada frame que confirmas viram dados de treino. Sobe
            os níveis até teres um modelo teu — sem depender do Gemini.
          </p>
        </div>
      </section>

      {/* Tools */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Ferramentas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <HomeCard href="/modelo" icon="📈" title="O teu modelo">
            Vê a evolução por níveis e testa o teu modelo contra o Gemini.
          </HomeCard>
          <HomeCard href="/tempo-util" icon="✂️" title="Cortar tempo útil">
            Recebe o vídeo só com o jogo ativo, sem o tempo morto.
          </HomeCard>
          <HomeCard href="/ajuda" icon="❓" title="Como funciona">
            Guia rápido para quem nunca usou e o que cada página faz.
          </HomeCard>
        </div>
      </section>
    </div>
  );
}

function HomeCard({
  href,
  icon,
  title,
  children,
}: {
  href: string;
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="block card card-hover p-5 group">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{icon}</span>
        <span className="font-semibold text-white group-hover:text-brand transition-colors">{title}</span>
      </div>
      <p className="text-sm text-gray-500">{children}</p>
    </Link>
  );
}
