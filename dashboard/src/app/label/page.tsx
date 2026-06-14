"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getLabelQueue, labelClip, labelClipUrl, type LabelQueue } from "@/lib/api";

const STROKE_LABELS: Record<string, string> = {
  forehand_volley: "Vólei de direita",
  backhand_volley: "Vólei de esquerda",
  bandeja: "Bandeja",
  vibora: "Víbora",
  smash: "Smash",
  serve: "Serviço",
};

export default function LabelPage() {
  const [queue, setQueue] = useState<LabelQueue | null>(null);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLabelled, setShowLabelled] = useState(false);

  const refresh = useCallback(async (keepIdx = false) => {
    try {
      const q = await getLabelQueue();
      setQueue(q);
      if (!keepIdx) setIdx(0);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const clips = queue ? queue.clips.filter((c) => showLabelled || c.label === null) : [];
  const safeIdx = Math.max(0, Math.min(idx, clips.length - 1));
  const current = clips[safeIdx] ?? null;

  const assign = useCallback(async (label: string) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await labelClip(current.name, label);
      setDone((d) => d + 1);
      // Remove locally and stay at the same index (next clip slides in)
      setQueue((q) => q && {
        ...q,
        clips: q.clips.map((c) => (c.name === current.name ? { ...c, label } : c)),
        n_unlabelled: Math.max(0, q.n_unlabelled - (current.label === null ? 1 : 0)),
        counts: { ...q.counts, [label]: (q.counts[label] ?? 0) + 1 },
      });
      if (showLabelled) setIdx((i) => Math.min(i + 1, clips.length - 1));
    } catch (e) {
      // Likely a colleague labelled/moved this clip first — resync the queue.
      setError(String(e));
      refresh(true);
    } finally {
      setBusy(false);
    }
  }, [current, busy, showLabelled, clips.length, refresh]);

  // Keyboard: digits assign the Nth label, j/k navigate, space replays.
  useEffect(() => {
    if (!queue) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 1 && n <= queue.labels.length) {
        assign(queue.labels[n - 1]);
        return;
      }
      switch (e.key) {
        case "j": case "ArrowDown": case "ArrowRight":
          e.preventDefault(); setIdx((i) => Math.min(i + 1, clips.length - 1)); break;
        case "k": case "ArrowUp": case "ArrowLeft":
          e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); break;
        case " ": {
          e.preventDefault();
          const v = document.querySelector<HTMLVideoElement>("#label-video");
          if (v) { v.currentTime = 0; v.play().catch(() => {}); }
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [queue, clips.length, assign]);

  if (error && !queue) return <div className="py-16 text-center text-red-400">{error}</div>;
  if (!queue) return <div className="py-16 text-center text-gray-400">A carregar…</div>;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Início</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-lg font-bold text-white">Etiquetar clips de pancadas</h1>
        <span className="text-xs text-gray-500 ml-auto">
          {queue.n_unlabelled} por classificar · {done} feitas nesta sessão
        </span>
      </div>

      <div className="text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5">
        ⚙️ Ferramenta interna de curadoria. Os tipos de pancada na análise vêm agora da
        IA — etiquetar aqui apenas organiza clips num dataset em disco, não treina o modelo.
      </div>

      {queue.clips.length === 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center text-sm text-gray-400 space-y-2">
          <p>Nenhum clip encontrado em <code className="text-gray-300">{queue.root}</code>.</p>
          <p className="text-gray-500">
            Corre o teu script de extração de pancadas para essa pasta (subpasta{" "}
            <code>por_classificar/</code>) e recarrega.
          </p>
        </div>
      )}

      {current ? (
        <>
          <video
            id="label-video"
            key={current.name}
            src={labelClipUrl(current.name)}
            autoPlay
            loop
            muted
            controls
            className="w-full rounded-xl border border-gray-700 bg-black"
          />
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="font-mono">{current.name}</span>
            {current.label && <span>atual: <b className="text-gray-300">{current.label}</b></span>}
            <span>{safeIdx + 1}/{clips.length}</span>
          </div>

          {/* Label buttons (1..9) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {queue.labels.map((label, i) => (
              <button
                key={label}
                onClick={() => assign(label)}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-3 bg-gray-900 hover:bg-gray-800 border border-gray-700 hover:border-blue-500 rounded-xl text-left transition-colors disabled:opacity-50"
              >
                <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-xs text-gray-400">{i + 1}</kbd>
                <span className="text-sm text-white">{STROKE_LABELS[label] ?? label}</span>
                <span className="ml-auto text-xs text-gray-600">{queue.counts[label] ?? 0}</span>
              </button>
            ))}
          </div>

          <p className="text-xs text-gray-600">
            Teclado: <kbd className="px-1 bg-gray-800 rounded">1</kbd>–
            <kbd className="px-1 bg-gray-800 rounded">{queue.labels.length}</kbd> etiquetar ·{" "}
            <kbd className="px-1 bg-gray-800 rounded">espaço</kbd> repetir ·{" "}
            <kbd className="px-1 bg-gray-800 rounded">j</kbd>/<kbd className="px-1 bg-gray-800 rounded">k</kbd> saltar.
            O ficheiro é movido para a pasta da etiqueta — a árvore de pastas é o dataset.
          </p>
        </>
      ) : queue.clips.length > 0 ? (
        <div className="bg-green-950/40 border border-green-800 rounded-xl p-8 text-center space-y-2">
          <p className="text-green-300 font-medium">🎉 Tudo classificado!</p>
          <p className="text-sm text-gray-400">
            {Object.entries(queue.counts).filter(([k]) => k !== "por_classificar").map(([k, v]) => k + ": " + v).join(" · ")}
          </p>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
        <input
          type="checkbox"
          checked={showLabelled}
          onChange={(e) => { setShowLabelled(e.target.checked); setIdx(0); }}
        />
        Mostrar também clips já etiquetados (para corrigir)
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
                }
