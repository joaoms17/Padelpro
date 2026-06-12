"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { saveCalibration } from "@/lib/api";

const CORNERS = [
  "1 · canto cima-esquerda",
  "2 · canto cima-direita",
  "3 · canto baixo-direita",
  "4 · canto baixo-esquerda",
];
const MAX_W = 720;

type Pt = { x: number; y: number };

export default function CalibratePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [courtId, setCourtId] = useState("court1");
  const [points, setPoints] = useState<Pt[]>([]);
  const [ready, setReady] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [videoErr, setVideoErr] = useState("");
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const v = videoRef.current;
    if (!file || !v) return;
    setPoints([]); setReady(false); setSaved(false); setStatus(""); setVideoErr("");
    setLoadingFrame(true);
    loadingRef.current = true;
    v.src = URL.createObjectURL(file);
    v.load();
    // Browsers podem adiar o carregamento de <video> escondido; play() força o
    // pipeline de decode a arrancar (permitido porque está muted).
    v.play().catch(() => { /* autoplay bloqueado — o load() acima ainda serve */ });

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (loadingRef.current) {
        loadingRef.current = false;
        setLoadingFrame(false);
        setVideoErr(
          "O vídeo não carregou. Verifica que é um MP4 (H.264) — vídeos de " +
          "telemóvel funcionam — e tenta de novo.",
        );
      }
    }, 12000);
  }

  function onLoadedMeta() {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.currentTime = Math.min(10, (v.duration || 20) / 2);
    } catch {
      loadingRef.current = false;
      setLoadingFrame(false);
      setVideoErr("Não consegui posicionar o vídeo — tenta outro ficheiro.");
    }
  }

  function onSeeked() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    v.pause();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    loadingRef.current = false;
    const w = Math.min(MAX_W, v.videoWidth);
    c.width = w;
    c.height = Math.round(w * (v.videoHeight / v.videoWidth));
    setLoadingFrame(false);
    setVideoErr("");
    setReady(true);
  }

  function onVideoError() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    loadingRef.current = false;
    setLoadingFrame(false);
    setVideoErr(
      "O browser não consegue ler este vídeo. Tenta um MP4 (H.264) — " +
      "se vier do telemóvel deve funcionar diretamente.",
    );
  }

  const redraw = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#1D9E75";
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
      ctx.fillText(String(i + 1), p.x + 10, p.y - 8);
    });
    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      if (points.length === 4) ctx.closePath();
      ctx.strokeStyle = "rgba(29,158,117,0.9)"; ctx.lineWidth = 2; ctx.stroke();
    }
  }, [points]);

  useEffect(() => { if (ready) redraw(); }, [ready, redraw]);

  function onClickCanvas(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!ready || points.length >= 4) return;
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (c.width / rect.width);
    const y = (e.clientY - rect.top) * (c.height / rect.height);
    setPoints((p) => [...p, { x, y }]);
  }

  async function submit() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || points.length !== 4) return;
    setStatus("A guardar…");
    const sx = v.videoWidth / c.width, sy = v.videoHeight / c.height;
    const pts = points.map((p) => [p.x * sx, p.y * sy]);
    try {
      await saveCalibration(courtId, pts, v.videoWidth, v.videoHeight);
      setSaved(true);
      setStatus(`Campo "${courtId}" calibrado ✓`);
    } catch (err: unknown) {
      setStatus("Erro: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/matches" className="text-gray-500 hover:text-gray-300 text-sm">← Jogos</Link>
        <h1 className="text-2xl font-bold text-white">Calibrar campo</h1>
      </div>

      <p className="text-sm text-gray-400 max-w-2xl">
        Carrega um vídeo deste campo/câmara e clica nos 4 cantos da linha exterior do court, por esta ordem.
        O vídeo fica no teu computador — só os 4 pontos são enviados. A calibração serve para todos os jogos da mesma câmara.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">ID do campo</label>
          <input
            value={courtId}
            onChange={(e) => setCourtId(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Vídeo do campo</label>
          <input
            type="file" accept="video/*" onChange={onFile}
            className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-brand file:text-white file:text-sm file:font-medium hover:file:bg-brand-dark cursor-pointer"
          />
        </div>
      </div>

      {ready && (
        <div className="space-y-3">
          <div className="text-sm text-gray-300">
            {points.length < 4
              ? <>Clica: <span className="text-brand font-medium">{CORNERS[points.length]}</span></>
              : <span className="text-green-400">4 cantos marcados ✓</span>}
          </div>
          <canvas
            ref={canvasRef}
            onClick={onClickCanvas}
            className="border border-gray-700 rounded-lg cursor-crosshair max-w-full"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setPoints([]); setSaved(false); setStatus(""); }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm"
            >Recomeçar</button>
            <button
              onClick={() => setPoints((p) => p.slice(0, -1))}
              disabled={!points.length}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg text-sm"
            >Desfazer</button>
            <button
              onClick={submit}
              disabled={points.length !== 4 || saved}
              className="px-4 py-2 bg-brand hover:bg-brand-dark disabled:opacity-40 text-white rounded-lg text-sm font-medium"
            >Guardar calibração</button>
          </div>
        </div>
      )}

      {loadingFrame && (
        <div className="flex items-center gap-2 text-sm text-blue-300">
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          A extrair uma imagem do vídeo…
        </div>
      )}
      {videoErr && <p className="text-sm text-red-400">{videoErr}</p>}
      {status && <p className={`text-sm ${saved ? "text-green-400" : "text-gray-400"}`}>{status}</p>}

      <video
        ref={videoRef}
        onLoadedMetadata={onLoadedMeta}
        onSeeked={onSeeked}
        onError={onVideoError}
        preload="auto"
        className="hidden"
        muted
        playsInline
      />
    </div>
  );
}
