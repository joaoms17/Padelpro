import Link from "next/link";

export const metadata = {
  title: "Como funciona — PadelPro Vision",
};

export default function AjudaPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-12">
      {/* Intro */}
      <header className="space-y-3 text-center pt-4">
        <h1 className="text-3xl font-bold text-white">Como funciona</h1>
        <p className="text-gray-400 max-w-xl mx-auto">
          O PadelPro analisa vídeos de jogos de padel: corta o tempo morto, conta as
          pancadas e mostra estatísticas por jogador. E melhora com a tua ajuda —
          cada correção que fazes treina o modelo. Este guia explica tudo, passo a passo.
        </p>
      </header>

      {/* Steps */}
      <Step n={1} title="Filmar o jogo" icon="🎥">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Coloca o telemóvel <b>atrás do campo, elevado</b> (em cima do vidro de fundo ou numa bancada), a apanhar o campo inteiro.</li>
          <li>Usa um <b>tripé ou apoio fixo</b> — a câmara não deve mexer durante o jogo.</li>
          <li>Filma na horizontal, 1080p chega. <b>Com som</b> — o som dos impactos ajuda a detetar as pancadas.</li>
          <li>Vídeos grandes: se passar o limite de upload, exporta em 720p ou corta em partes.</li>
        </ul>
      </Step>

      <Step n={2} title="Analisar" icon="⚡">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Na página <Link href="/" className="text-brand hover:underline">⚡ Analisar</Link>, escolhe o vídeo e carrega em <b>Analisar jogo</b>.</li>
          <li>Marca <b>📊 Analisar jogadores</b> para receberes as estatísticas (distâncias, zonas, heatmap, pancadas) além do vídeo cortado.</li>
          <li>A opção <b>🎯 Deteção da bola</b> melhora a atribuição das pancadas, mas demora mais uns minutos.</li>
          <li>Demora normal: alguns minutos por jogo. Deixa a página aberta.</li>
        </ul>
      </Step>

      <Step n={3} title="Ler o relatório" icon="📊">
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>Tempo útil</b> — quanto do vídeo foi mesmo jogo (o resto é apanhar bolas e discutir o ponto 😄).</li>
          <li><b>Zonas</b> — % do tempo de cada jogador na rede, meio e fundo. Em padel, quem domina a rede normalmente ganha.</li>
          <li><b>Heatmap</b> — onde cada jogador passou mais tempo no campo.</li>
          <li><b>Pancadas</b> — quantas batidas deu cada jogador e de que tipo.</li>
          <li>Para posições em metros reais, o campo precisa de estar <Link href="/calibrate" className="text-brand hover:underline">calibrado</Link> (uma vez por câmara — clicas os 4 cantos e está).</li>
        </ul>
      </Step>

      <Step n={4} title="Rever as pancadas (ajudas a treinar o modelo)" icon="✓">
        <p className="mb-2">
          No fim de uma análise aparece o botão <b>✓ Rever batidas</b>. O vídeo salta
          para cada pancada detetada e tu confirmas ou corriges. É literalmente assim
          que o modelo aprende.
        </p>
        <KeyTable
          rows={[
            ["1", "a pancada está certa"],
            ["2", "é pancada, mas o tipo está errado (escolhes o certo)"],
            ["3", "não foi pancada nenhuma (falso alarme)"],
            ["j / k", "pancada seguinte / anterior"],
            ["espaço", "repetir o replay"],
          ]}
        />
        <p className="mt-2 text-gray-500">
          Marca também pancadas que o modelo não viu: pausa o vídeo no impacto e usa
          “+ Adicionar aqui”. No fim, <b>Submeter</b> — e se já houver correções
          suficientes, podes carregar em <b>🔁 Retreinar modelo</b>.
        </p>
      </Step>

      <Step n={5} title="Etiquetar clips" icon="🏷️">
        <p className="mb-2">
          Na página <Link href="/label" className="text-brand hover:underline">Etiquetar</Link> aparecem
          clips curtos de pancadas, um de cada vez, em loop. Só tens de dizer que pancada é.
        </p>
        <KeyTable
          rows={[
            ["1–9", "atribuir a classe (o número de cada botão)"],
            ["espaço", "ver o clip outra vez"],
            ["j / k", "saltar para a frente / trás sem etiquetar"],
          ]}
        />
        <p className="mt-2 text-gray-500">
          Podem estar várias pessoas a etiquetar ao mesmo tempo — cada um recebe clips
          diferentes. Um clip leva ~5 segundos; uma centena despacha-se num café. ☕
        </p>
      </Step>

      <Step n={6} title="O que acontece ao teu trabalho" icon="🔁">
        <p>
          Cada revisão e cada etiqueta viram <b>exemplos de treino</b>. Quando há
          exemplos suficientes, o modelo é retreinado e o jogo seguinte já é analisado
          com a versão melhorada — e também usamos as tuas correções para <b>medir</b> se
          o modelo está mesmo a melhorar de versão para versão. Ciclo completo:
        </p>
        <div className="mt-3 card px-4 py-3 text-sm text-gray-300 text-center font-mono">
          jogar → analisar → rever/etiquetar → retreinar → repetir
        </div>
      </Step>

      {/* FAQ */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Dúvidas rápidas</h2>
        <Faq q="Enganei-me numa etiqueta. E agora?">
          Na página Etiquetar, ativa “Mostrar também clips já etiquetados” e corrige.
          Na revisão de pancadas, basta voltar a submeter — a versão nova substitui a antiga.
        </Faq>
        <Faq q="O modelo enganou-se imenso no meu jogo. Vale a pena rever?">
          Vale a dobrar: as correções em jogos onde o modelo falha muito são os exemplos
          mais valiosos para o treino. Os erros de hoje são a precisão de amanhã.
        </Faq>
        <Faq q="Preciso de calibrar o campo sempre?">
          Não — uma vez por câmara/posição. Se a câmara mudar de sítio, recalibra
          (são 4 cliques).
        </Faq>
        <Faq q="Os meus vídeos ficam guardados?">
          Os vídeos são processados no servidor da equipa e os ficheiros temporários são
          limpos periodicamente. As estatísticas e correções ficam guardadas.
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

function KeyTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="card divide-y divide-gray-800 text-sm">
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
