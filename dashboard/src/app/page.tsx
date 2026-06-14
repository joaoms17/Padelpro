"use client";

import Link from "next/link";
import { CondenseForm } from "@/components/CondenseForm";

export default function HomePage() {
  return (
    <div className="space-y-10">
      {/* Hero + main flow */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        <div className="lg:col-span-2 space-y-4 pt-2">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Analisa o teu jogo de{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-emerald-300">
              padel
            </span>
          </h1>
          <p className="text-gray-400">
            Carrega o vídeo e recebe o <span className="text-gray-200">tempo útil</span> do
            jogo, as <span className="text-gray-200">estatísticas por jogador</span>{" "}
            (distâncias, zonas, heatmaps) e a <span className="text-gray-200">leitura da IA</span> —
            tipos de pancada, winners/erros e tática.
          </p>
          <ol className="text-sm text-gray-500 space-y-2">
            <li className="flex gap-2"><span className="text-brand font-bold">1.</span> Filma o jogo de trás do campo (telemóvel serve)</li>
            <li className="flex gap-2"><span className="text-brand font-bold">2.</span> Carrega o vídeo aqui ao lado</li>
            <li className="flex gap-2"><span className="text-brand font-bold">3.</span> Vê o relatório e revê as pancadas para corrigir o que a IA leu mal</li>
          </ol>
          <Link href="/ajuda" className="inline-block text-sm text-brand hover:underline">
            Guia completo para quem nunca usou →
          </Link>
        </div>

        <div className="lg:col-span-3 card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">⚡ Analisar jogo</h2>
          <CondenseForm />
        </div>
      </section>

      {/* Secondary actions */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Ferramentas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <HomeCard href="/matches" icon="🎾" title="Jogos analisados">
            Histórico de análises completas, com clips e montagens por pancada.
          </HomeCard>
          <HomeCard href="/qualidade" icon="📈" title="Saúde da deteção">
            Deteção, tracking e calibração em todos os jogos processados.
          </HomeCard>
          <HomeCard href="/calibrate" icon="📐" title="Calibrar campo">
            Clica os 4 cantos do campo uma vez por câmara — ativa posições em metros.
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
  badge,
  children,
}: {
  href: string;
  icon: string;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block card card-hover p-5 group"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{icon}</span>
        <span className="font-semibold text-white group-hover:text-brand transition-colors">{title}</span>
        {badge && (
          <span className="ml-auto text-xs bg-brand/20 text-brand px-2 py-0.5 rounded-full font-medium">
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500">{children}</p>
    </Link>
  );
}
