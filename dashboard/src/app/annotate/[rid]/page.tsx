"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  getAnnotationData,
  getAnnotationFrame,
  submitAnnotations,
  triggerBallRetrain,
  triggerPlayerRetrain,
  getAnnotateRetrainStatus,
  type AnnotationData,
} from "@/lib/api";

const OUTCOME_OPTS = [
  { v: "winner",          l: "Winner" },
  { v: "unforced_error",  l: "Erro n.f." },
  { v: "forced_error",    l: "Erro f." },
  { v: "let",             l: "Let" },
  { v: "continuation",    l: "Continua" },
];

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type BallMark = { x_norm: number; y_norm: number; radius_norm: number };

interface ShotAnn {
  ball?: BallMark | null;  // undefined = not annotated, null = no ball visible
  outcome?: string;
  correctedPlayerId?: number;
}

export default function AnnotatePage({ params }: { params: { rid: string } }) {
  const { rid } = params;
  const [data, setData] = useState<AnnotationData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [frameInfo, setFrameInfo] = useState<{ blob: Blob; w: number; h: number } | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [anns, setAnns] = useState<Record<number, ShotAnn>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ balls: number; outcomes: number; player_ids: number } | null>(null);
  const [retrainState, setRetrainState] = useState<Record<string, { status: string; detail?: string }>>({});

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameDims = useRef({ w: 0, h: 0 });
  const canvasDims = useRef({ w: 0, h: 0 });

  useEffect(() => {
    getAnnotationData(rid).then(setData).catch((e) => setErr(String(e)));
  }, [rid]);

  async function selectShot(idx: number) {
    setSelected(idx);
    if (!data) return;
    setFrameLoading(true);
    setFrameInfo(null);
    imgRef.current = null;
    try {
      const { blob, width, height } = await getAnnotationFrame(rid, data.shots[idx].ts_ms);
      setFrameInfo({ blob, w: width, h: height });
    } catch {
      // video expired — frame not available
    } finally {
      setFrameLoading(false);
    }
  }

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (selected !== null) {
      const ball = anns[selected]?.ball;
      if (ball) {
        const cx = ball.x_norm * c.width;
        const cy = ball.y_norm * c.height;
        const r = Math.max(6, ball.radius_norm * Math.min(c.width, c.height));
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = "rgba(34,197,94,0.25)";
        ctx.fill();
        // crosshair
        ctx.beginPath();
        ctx.moveTo(cx - r - 4, cy); ctx.lineTo(cx + r + 4, cy);
        ctx.moveTo(cx, cy - r - 4); ctx.lineTo(cx, cy + r + 4);
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }, [selected, anns]);

  useEffect(() => {
    if (!frameInfo) return;
    const img = new Image();
    img.onload = () => {
      const maxW = 680;
      const w = Math.min(maxW, frameInfo.w || img.naturalWidth);
      const h = Math.round(w * (frameInfo.h || img.naturalHeight) / (frameInfo.w || img.naturalWidth));
      canvasDims.current = { w, h };
      frameDims.current = { w: frameInfo.w, h: frameInfo.h };
      imgRef.current = img;
      const c = canvasRef.current;
      if (c) { c.width = w; c.height = h; }
      redraw();
    };
    img.src = URL.createObjectURL(frameInfo.blob);
  }, [frameInfo, redraw]);

  useEffect(() => {
    if (frameInfo) redraw();
  }, [redraw, frameInfo]);

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (selected === null) return;
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (c.width / rect.width);
    const cy = (e.clientY - rect.top) * (c.height / rect.height);
    const minDim = Math.min(c.width, c.height);
    setAnns((prev) => ({
      ...prev,
      [selected]: { ...prev[selected], ball: { x_norm: cx / c.width, y_norm: cy / c.height, radius_norm: 14 / minDim } },
    }));
  }

  useEffect(() => { redraw(); }, [anns, redraw]);

  function setAnn<K extends keyof ShotAnn>(idx: number, key: K, val: ShotAnn[K]) {
    setAnns((prev) => ({ ...prev, [idx]: { ...prev[idx], [key]: val } }));
  }

  async function handleSubmit() {
    if (!data) return;
    setSubmitting(true);
    setErr(null);
    try {
      const balls = Object.entries(anns)
        .filter(([, a]) => a.ball)
        .map(([i, a]) => ({
          ts_ms: data.shots[Number(i)].ts_ms,
          ...a.ball!,
          frame_w: frameDims.current.w,
          frame_h: frameDims.current.h,
        }));
      const outcomes = Object.entries(anns)
        .filter(([, a]) => a.outcome)
        .map(([i, a]) => ({
          ts_ms: data.shots[Number(i)].ts_ms,
          player_id: data.shots[Number(i)].player_id,
          outcome: a.outcome!,
        }));
      const player_ids = Object.entries(anns)
        .filter(([i, a]) => a.correctedPlayerId !== undefined && a.correctedPlayerId !== data.shots[Number(i)].player_id)
        .map(([i, a]) => ({
          ts_ms: data.shots[Number(i)].ts_ms,
          original_player_id: data.shots[Number(i)].player_id,
          corrected_player_id: a.correctedPlayerId!,
        }));
      const result = await submitAnnotations(rid, { balls, outcomes, player_ids });
      setSubmitResult(result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const running = Object.values(retrainState).some((s) => s.status === "running");
    if (!running) return;
    const iv = setInterval(async () => {
      try {
        const s = await getAnnotateRetrainStatus();
        setRetrainState(s);
        if (!Object.values(s).some((x) => x.status === "running")) clearInterval(iv);
      } catch { /**/ }
    }, 3000);
    return () => clearInterval(iv);
  }, [retrainState]);

  if (err && !data) return (
    <div className="py-16 text-center space-y-3">
      <p className="text-red-400">{err}</p>
      <Link href="/matches" className="text-sm text-gray-500 hover:text-gray-300">← Voltar</Link>
    </div>
  );
  if (!data) return <div className="text-gray-400 py-16 text-center">A carregar…</div>;

  const totalAnn = Object.values(anns).filter((a) => a.ball !== undefined || a.outcome || a.correctedPlayerId !== undefined).length;
  const ballCount = Object.values(anns).filter((a) => a.ball).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/review/${rid}`} className="text-gray-500 hover:text-gray-300 text-sm">← Rever batidas</Link>
        <h1 className="text-lg font-bold text-white">Anotar para treino</h1>
        <span className="text-xs text-gray-500">{totalAnn}/{data.shots.length} anotadas · {data.n_ball_annotations} bolas guardadas</span>
      </div>

      <p className="text-sm text-gray-400 max-w-2xl">
        Clica numa batida → vês o frame → clica na bola (verde). Também podes marcar o resultado e corrigir o jogador.
        Estas anotações treinam os detetores de bola e jogadores.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Frame canvas */}
        <div className="space-y-2">
          {frameLoading && (
            <div className="flex items-center gap-2 text-sm text-blue-300">
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
              A extrair frame…
            </div>
          )}
          {!frameLoading && selected === null && (
            <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-10 text-center text-sm text-gray-500">
              Clica numa batida para ver o frame.
            </div>
          )}
          {!frameLoading && selected !== null && !frameInfo && (
            <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-10 text-center text-sm text-gray-500">
              Frame não disponível — vídeo expirou.<br/>
              <span className="text-xs">Ainda podes marcar outcome e jogador.</span>
            </div>
          )}
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            className={`border border-gray-700 rounded-xl max-w-full ${frameInfo && !frameLoading ? "cursor-crosshair" : "hidden"}`}
          />
          {selected !== null && frameInfo && !frameLoading && (
            <div className="flex gap-3 text-sm flex-wrap items-center">
              <span className="text-gray-400 text-xs">Clica na bola acima.</span>
              {anns[selected]?.ball && (
                <>
                  <span className="text-green-400 text-xs">⚽ marcada</span>
                  <button
                    onClick={() => setAnn(selected, "ball", undefined)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >remover</button>
                </>
              )}
              <button
                onClick={() => setAnn(selected, "ball", null)}
                className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-2 py-0.5"
              >Sem bola visível</button>
            </div>
          )}
        </div>

        {/* Shot list */}
        <div className="space-y-1.5 max-h-[72vh] overflow-y-auto pr-1">
          {data.shots.map((shot, i) => {
            const ann = anns[i] || {};
            const hasBall = ann.ball !== undefined;
            const isSelected = selected === i;
            const playerChanged = ann.correctedPlayerId !== undefined && ann.correctedPlayerId !== shot.player_id;
            return (
              <div
                key={`${i}-${shot.ts_ms}`}
                onClick={() => selectShot(i)}
                className={`bg-gray-900 border rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${
                  isSelected ? "border-blue-500 bg-gray-800" : hasBall || ann.outcome ? "border-gray-500" : "border-gray-700 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-blue-400 w-10">{fmtTime(shot.ts_ms)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${playerChanged ? "bg-yellow-900 text-yellow-300" : "bg-gray-800 text-gray-400"}`}>
                    J{ann.correctedPlayerId ?? shot.player_id}
                  </span>
                  <span className="text-sm text-white">{shot.stroke_type}</span>
                  {hasBall && <span className="text-xs text-green-400">⚽</span>}
                  {ann.ball === null && <span className="text-xs text-gray-600">∅</span>}

                  <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={ann.outcome ?? ""}
                      onChange={(e) => setAnn(i, "outcome", e.target.value || undefined)}
                      className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-300 max-w-[100px]"
                    >
                      <option value="">resultado?</option>
                      {OUTCOME_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                    <select
                      value={ann.correctedPlayerId ?? shot.player_id}
                      onChange={(e) => setAnn(i, "correctedPlayerId", Number(e.target.value))}
                      className={`bg-gray-800 border rounded px-1.5 py-0.5 text-xs w-12 ${playerChanged ? "border-yellow-600 text-yellow-300" : "border-gray-700 text-gray-500"}`}
                    >
                      {[1, 2, 3, 4].map((p) => <option key={p} value={p}>J{p}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Submit + retrain */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl px-5 py-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleSubmit}
            disabled={submitting || totalAnn === 0}
            className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg font-medium"
          >
            {submitting ? "A guardar…" : `Guardar ${totalAnn} anotações`}
          </button>
          {submitResult && (
            <span className="text-sm text-green-400">
              ✓ {submitResult.balls} bolas · {submitResult.outcomes} resultados · {submitResult.player_ids} correções de ID
            </span>
          )}
          {err && <span className="text-sm text-red-400">{err}</span>}
        </div>

        <div className="border-t border-gray-800 pt-3 space-y-2">
          <p className="text-xs text-gray-500">Retreinar com todas as anotações acumuladas:</p>
          <div className="flex gap-3 flex-wrap">
            <RetrainBtn
              label="Detetor de bola"
              emoji="⚽"
              state={retrainState.ball}
              onStart={async () => {
                await triggerBallRetrain();
                setRetrainState((p) => ({ ...p, ball: { status: "running" } }));
              }}
            />
            <RetrainBtn
              label="Detetor de jogadores"
              emoji="🏃"
              state={retrainState.player}
              onStart={async () => {
                await triggerPlayerRetrain();
                setRetrainState((p) => ({ ...p, player: { status: "running" } }));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function RetrainBtn({
  label, emoji, state, onStart,
}: {
  label: string; emoji: string;
  state?: { status: string; detail?: string; n_samples?: number };
  onStart: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const running = state?.status === "running" || busy;
  return (
    <div className="space-y-1">
      <button
        onClick={async () => { setBusy(true); try { await onStart(); } finally { setBusy(false); } }}
        disabled={running}
        className="px-4 py-1.5 bg-blue-800 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-sm"
      >
        {running ? "A treinar…" : `🔁 ${emoji} ${label}`}
      </button>
      {state && state.status !== "running" && state.status !== "idle" && (
        <p className={`text-xs ${state.status === "ok" ? "text-green-400" : state.status === "skipped" ? "text-yellow-400" : "text-red-400"}`}>
          {state.detail}
        </p>
      )}
    </div>
  );
}
