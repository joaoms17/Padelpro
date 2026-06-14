import Link from "next/link";

export const metadata = {
  title: "Como funciona — PadelPro",
};

export default function AjudaPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-12">
      {/* Intro */}
      <header className="space-y-3 text-center pt-4">
        <h1 className="text-3xl font-bold text-white">Como funciona</h1>
        <p className="text-gray-400 max-w-xl mx-auto leading-relaxed">
          O PadelPro tem duas partes. <b className="text-gray-200">Parte 1:</b> carregas
          um vídeo e a IA (Gemini) lê o jogo todo — heatmap, resultado, pancadas e
          formações. <b className="text-gray-200">Parte 2:</b> esses resultados, e os
          frames que confirmas, viram dados para treinar o <b>nosso próprio modelo</b>,
          para deixarmos de depender do Gemini. Este guia explica cada passo e cada página.
        </p>
      </header>

      {/* Steps */}
      <Step n={1} title="Filmar o jogo" icon="🎥">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Coloca o telemóvel <b>atrás do campo, elevado</b>, a apanhar o campo inteiro.</li>
          <li>Usa um <b>apoio fixo</b> — a câmara não deve mexer durante o jogo.</li>
          <li>Filma na horizontal, 1080p chega. Se o ficheiro for grande, exporta em 720p.</li>
        </ul>
      </Step>

      <Step n={2} title="Analisar (Parte 1)" icon="⚡">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Na página <Link href="/" className="text-brand hover:underline">⚡ Analisar</Link>, escolhe o vídeo do PC ou cola um link/YouTube.</li>
          <li>Carrega em <b>Analisar jogo</b>. A IA lê o vídeo todo — demora alguns minutos. Deixa a página aberta.</li>
        </ul>
      </Step>

      <Step n={3} title="Ler o relatório" icon="📊">
        <p className="mb-2">O relatório do jogo mostra:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>Heatmap</b> — onde cada um dos 4 jogadores passou mais tempo no campo.</li>
          <li><b>Resultado</b> — a previsão da IA (com botões para validares se acertou).</li>
          <li><b>Pancadas</b> — quantas e de que tipo cada jogador bateu.</li>
          <li><b>Formações</b> — % de tempo em cada configuração (ambos na rede, ambos no fundo, um sobe um atrás).</li>
          <li><b>Frames de exemplo</b> — momentos com os 4 jogadores e a bola visíveis.</li>
          <li><b>Tempo útil</b> — quanto do vídeo foi mesmo jogo (rallies).</li>
        </ul>
      </Step>

      <Step n={4} title="Contribuir para o treino (Parte 2)" icon="✋">
        <p className="mb-2">
          No relatório, carrega em <b>Contribuir para treino</b>. Abre um ecrã simples,
          <b> uma imagem de cada vez</b>, onde confirmas tudo no mesmo sítio:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>marcas a <b>bola</b> (clicas onde ela está),</li>
          <li>confirmas <b>quem</b> deu a pancada,</li>
          <li>e o <b>tipo/resultado</b> da jogada.</li>
        </ul>
        <KeyTable
          rows={[
            ["← / →", "frame anterior / seguinte"],
            ["Enter", "confirmar e avançar"],
          ]}
        />
        <p className="mt-2 text-gray-500">
          Cada imagem que confirmas é uma amostra de treino para o nosso modelo.
        </p>
      </Step>

      <Step n={5} title="O teu modelo" icon="📈">
        <p>
          Na página <Link href="/modelo" className="text-brand hover:underline">O teu modelo</Link> vês
          a tua <b>evolução por níveis</b> (1 a 5) por cada modelo — detetor de bola, de
          jogadores e classificador de pancadas. Quando tiveres amostras suficientes,
          treinas o modelo e podes <b>testá-lo contra o Gemini</b>. O objetivo é
          construíres um modelo teu, melhor e sem custo por jogo.
        </p>
        <div className="mt-3 card px-4 py-3 text-sm text-gray-300 text-center font-mono">
          jogar → analisar (Gemini) → confirmar frames → subir de nível → treinar o teu modelo
        </div>
      </Step>

      {/* What each page does */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white">O que cada página faz</h2>
        <PageRow href="/" name="Analisar" desc="Carregas o vídeo e geras o relatório completo da IA." />
        <PageRow href="/modelo" name="O teu modelo" desc="Evolução por níveis e teste do teu modelo vs Gemini." />
        <PageRow href="/tempo-util" name="Tempo útil" desc="Recebes o vídeo só com o jogo ativo, sem o tempo morto." />
        <PageRow href="/ajuda" name="Como funciona" desc="Este guia." />
      </section>

      {/* FAQ */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Dúvidas rápidas</h2>
        <Faq q="Quanto tempo demora a análise?">
          Alguns minutos, conforme o tamanho do vídeo. Corre tudo na cloud — não precisas do PC ligado.
        </Faq>
        <Faq q="O link do YouTube não funciona.">
          O YouTube por vezes bloqueia downloads a partir de servidores. Nesse caso, descarrega o vídeo e carrega o ficheiro do PC.
        </Faq>
        <Faq q="Para que serve confirmar os frames?">
          Cada frame confirmado é uma amostra de treino. Quantos mais confirmas, mais sobes de nível e mais perto ficas de um modelo teu.
        </Faq>
        <Faq q="Os meus vídeos ficam guardados?">
          São processados no servidor e os ficheiros temporários são limpos periodicamente. Os relatórios e anotações ficam guardados.
        </Faq>
      </section>

      {/* CTA */}
      <div className="text-center pb-4">
        <Link href="/" className="btn-primary inline-block px-8 py-3">
          ⚡ Analisar o meu primeiro jogo
        </Link>
      </div>
    </div>
  );
}

function Step({ n, title, icon, children }: {
  n: number;
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card card-hover p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-8 h-8 rounded-full bg-brand/15 text-brand font-bold flex items-center justify-center text-sm">
          {n}
        </span>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <span className="ml-auto text-2xl">{icon}</span>
      </div>
      <div className="text-sm text-gray-400 leading-relaxed">{children}</div>
    </section>
  );
}

function PageRow({ href, name, desc }: { href: string; name: string; desc: string }) {
  return (
    <Link href={href} className="card card-hover flex items-center gap-4 px-5 py-3">
      <span className="font-semibold text-white min-w-[8rem]">{name}</span>
      <span className="text-sm text-gray-500">{desc}</span>
    </Link>
  );
}

function KeyTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="card divide-y divide-gray-800 text-sm mt-2">
      {rows.map(([key, desc]) => (
        <div key={key} className="flex items-center gap-4 px-4 py-2">
          <span className="kbd min-w-[3.5rem] text-center">{key}</span>
          <span className="text-gray-400">{desc}</span>
        </div>
      ))}
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="card px-5 py-4 group">
      <summary className="cursor-pointer text-sm font-medium text-gray-200 list-none flex items-center justify-between">
        {q}
        <span className="text-gray-600 group-open:rotate-90 transition-transform">›</span>
      </summary>
      <p className="text-sm text-gray-500 mt-2 leading-relaxed">{children}</p>
    </details>
  );
}
