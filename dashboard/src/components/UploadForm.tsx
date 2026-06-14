"use client";

import { useState, useRef } from "react";
import { createMatch, uploadVideo } from "@/lib/api";
import { useRouter } from "next/navigation";

type Tab = "file" | "youtube";

export function UploadForm() {
  const [tab, setTab] = useState<Tab>("file");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus("");

    try {
      if (tab === "youtube") {
        if (!youtubeUrl.trim()) {
          setStatus("Insere um URL do YouTube.");
          setLoading(false);
          return;
        }
        setStatus("A registar jogo e iniciar download…");
        const { match_id } = await createMatch(youtubeUrl.trim());
        router.push(`/matches/${match_id}`);
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setStatus("Seleciona um ficheiro de vídeo.");
          setLoading(false);
          return;
        }
        setStatus("A registar jogo…");
        const { match_id } = await createMatch();

        setStatus("A enviar vídeo…");
        await uploadVideo(match_id, file);

        router.push(`/matches/${match_id}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Erro: ${message}`);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Tabs */}
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        <button
          type="button"
          onClick={() => setTab("file")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === "file"
              ? "bg-brand text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Ficheiro local
        </button>
        <button
          type="button"
          onClick={() => setTab("youtube")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === "youtube"
              ? "bg-brand text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          YouTube
        </button>
      </div>

      {/* File input */}
      {tab === "file" && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Vídeo do jogo
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-700 file:text-white file:text-sm file:font-medium hover:file:bg-gray-600 cursor-pointer"
          />
        </div>
      )}

      {/* YouTube input */}
      {tab === "youtube" && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            URL do YouTube
          </label>
          <input
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-500"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition-colors"
      >
        {loading ? "A processar…" : "Analisar jogo"}
      </button>

      {status && (
        <p className={`text-xs ${status.startsWith("Erro") ? "text-red-400" : "text-gray-400"}`}>
          {status}
        </p>
      )}
    </form>
  );
}
