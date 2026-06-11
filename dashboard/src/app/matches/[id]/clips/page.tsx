"use client";

import Link from "next/link";
import { ClipBrowser } from "@/components/ClipBrowser";

export default function ClipsPage({ params }: { params: { id: string } }) {
  const matchId = params.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/matches" className="text-gray-500 hover:text-gray-300 text-sm">← Jogos</Link>
        <span className="text-gray-700">/</span>
        <Link href={`/matches/${matchId}`} className="text-gray-500 hover:text-gray-300 text-sm font-mono">
          {matchId.slice(0, 8)}…
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-white text-sm">Clips</span>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Browser de clips</h2>
        <p className="text-xs text-gray-500">
          Filtrar por jogador, pancada e zona — sem renderizar vídeo
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <ClipBrowser matchId={matchId} />
      </div>
    </div>
  );
}
