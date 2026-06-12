"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { saveCalibration, autoDetectCorners, extractCalibrationFrame } from "@/lib/api";

const CORNERS = [
  "1 · canto cima-esquerda",
  "2 · canto cima-direita",
  "3 · canto baixo-direita",
  "4 · canto baixo-esquerda",
];
const MAX_W = 720;

type Pt = { x: number; y: number };

export default function CalibratePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Real frame size (original video pixels) — clicks are scaled back to this.
  const frameSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const [courtId, setCourtId] = useState("court1");
  const [points, setPoints] = useState<Pt[]>([]);
  const [ready, setReady] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [videoErr, setVideoErr] = useState("");
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPoints([]); setReady(false); setSaved(false); setStatus(""); setVideoErr("");
    setLoadingFrame(true);
    try {
      // The server decodes the video (any codec, incl. HEVC) and returns one frame.
      const { blob, width, height } = await extractCalibrationFrame(file);
      frameSize.current = { w: width, h: height };

      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        if (!c) return;
        const w = Math.min(MAX_W, width || img.naturalWidth);
        c.width = w;
        c.height = Math.round(w * ((height || img.naturalHeight) / (width || img.naturalWidth)));
        imgRef.current = img;
        setLoadingFrame(false);
        setReady(true);
      };
      img.onerror = () => {
        setLoadingFrame(false);
        setVideoErr("Não consegui mostrar o frame extraído.");
      };
      img.src = URL.createObjectURL(blob);
    } catch (err) {
      setLoadingFrame(false);
      setVideoErr(
        "Não consegui extrair um frame do vídeo no servidor. Confirma que a API está a correr " +
        "(sem faixa amarela no topo) e tenta outro ficheiro. Erro: " +
        (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  const redraw = useCallback(() => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
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

  async function autoDetect() {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img || autoBusy) return;
    setAutoBusy(true);
    setStatus("A detetar os cantos…");
    try {
      // Full-resolution frame for the server-side detector
      const full = document.createElement("canvas");
      full.width = frameSize.current.w || img.naturalWidth;
      full.height = frameSize.current.h || img.naturalHeight;
      full.getContext("2d")!.drawImage(img, 0, 0, full.width, full.height);
      const blob: Blob = await new Promise((resolve, reject) =>
        full.toBlob((b) => (b ? resolve(b) : reject(new Error("frame"))), "image/jpeg", 0.85)
      );
      const res = await autoDetectCorners(blob);
      const sx = c.width / full.width, sy = c.height / full.height;
      setPoints(res.points.map(([x, y]) => ({ x: x * sx, y: y * sy })));
      setSaved(false);
      setStatus(
        res.quality.rating === "good"
          ? "Cantos detetados ✓ — confirma na imagem e guarda."
          : "Cantos detetados (qualidade média) — ajusta com Recomeçar se estiverem tortos."
      );
    } catch {
      setStatus("Não consegui detetar automaticamente — clica os 4 cantos à mão.");
    } finally {
      setAutoBusy(false);
    }
  }

  async function submit() {
    const c = canvasRef.current;
    if (!c || points.length !== 4) return;
    setStatus("A guardar…");
    const fw = frameSize.current.w || c.width;
    const fh = frameSize.current.h || c.height;
    const sx = fw / c.width, sy = fh / c.height;
    const pts = points.map((p) => [p.x * sx, p.y * sy]);
    try {
      await saveCalibration(courtId, pts, fw, fh);
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
        O frame é extraído no servidor (funciona com qualquer formato, incluindo vídeos de iPhone/WhatsApp).
        A calibração serve para todos os jogos da mesma câmara.
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
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={autoDetect}
              disabled={autoBusy}
              className="px-4 py-2 bg-brand/20 hover:bg-brand/30 text-brand rounded-lg text-sm font-medium disabled:opacity-50"
            >{autoBusy ? "A detetar…" : "🪄 Detetar automaticamente"}</button>
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
          A extrair uma imagem do vídeo (no servidor)…
        </div>
      )}
      {videoErr && <p className="text-sm text-red-400">{videoErr}</p>}
      {status && <p className={`text-sm ${saved ? "text-green-400" : "text-gray-400"}`}>{status}</p>}
    </div>
  );
}
