"use client";

import { useEffect, useRef } from "react";

/**
 * Court heatmap — smooth density overlay on a drawn court (the presentation
 * style club systems use), rendered from the same 20×10 normalised grid.
 *
 * Pipeline: grid → small ImageData (alpha = intensity) → bilinear upscale →
 * blur → colourised overlay on the court graphic → court lines on top.
 */
export function HeatmapGrid({
  grid,
  marker,
}: {
  grid: number[][];
  marker?: [number, number] | null;   // mean position in court metres (10×20)
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid || grid.length === 0) return;
    const W = 300, H = 600;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // --- Court base -------------------------------------------------------
    ctx.fillStyle = "#0e4429";                   // padel green
    ctx.fillRect(0, 0, W, H);

    // --- Heat overlay -----------------------------------------------------
    const rows = grid.length, cols = grid[0].length;
    const small = document.createElement("canvas");
    small.width = cols;
    small.height = rows;
    const sctx = small.getContext("2d")!;
    const img = sctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = Math.max(0, Math.min(1, grid[r][c]));
        const [cr, cg, cb] = heatColour(v);
        const i = (r * cols + c) * 4;
        img.data[i] = cr;
        img.data[i + 1] = cg;
        img.data[i + 2] = cb;
        img.data[i + 3] = Math.round(Math.pow(v, 0.7) * 215);   // alpha = intensity
      }
    }
    sctx.putImageData(img, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = "blur(7px)";
    ctx.drawImage(small, 0, 0, cols, rows, -10, -10, W + 20, H + 20);
    ctx.restore();

    // --- Court lines ------------------------------------------------------
    const m = 6;                                  // outline margin
    const serviceFrac = 6.95 / 20;                // ITF: service line 6.95 m from back
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);

    const line = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    const ySvcTop = m + (H - 2 * m) * serviceFrac;
    const ySvcBot = H - m - (H - 2 * m) * serviceFrac;
    line(m, ySvcTop, W - m, ySvcTop);             // service line (top half)
    line(m, ySvcBot, W - m, ySvcBot);             // service line (bottom half)
    line(W / 2, ySvcTop, W / 2, m);               // centre line top
    line(W / 2, ySvcBot, W / 2, H - m);           // centre line bottom

    // Net
    ctx.strokeStyle = "rgba(140,220,255,0.9)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    line(0, H / 2, W, H / 2);
    ctx.setLineDash([]);

    // Mean-position marker
    if (marker) {
      const mx = (marker[0] / 10) * W;
      const my = (marker[1] / 20) * H;
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#16a34a";
      ctx.stroke();
    }
  }, [grid, marker]);

  if (!grid || grid.length === 0) return <div className="text-gray-400 text-sm">Sem dados</div>;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-white/20"
        style={{ aspectRatio: "1 / 2" }}
      />
      <div className="absolute -bottom-5 left-0 right-0 flex justify-between text-[10px] text-gray-400">
        <span>Esq</span>
        <span>Dir</span>
      </div>
    </div>
  );
}

function heatColour(v: number): [number, number, number] {
  // transparent-green → yellow → orange → red (alpha handled by caller)
  const stops: [number, [number, number, number]][] = [
    [0,    [40,  200, 120]],
    [0.35, [180, 220, 60]],
    [0.6,  [250, 200, 40]],
    [0.8,  [250, 120, 30]],
    [1,    [235, 40,  35]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (v <= t1) {
      const t = (v - t0) / Math.max(1e-6, t1 - t0);
      return [
        Math.round(c0[0] + t * (c1[0] - c0[0])),
        Math.round(c0[1] + t * (c1[1] - c0[1])),
        Math.round(c0[2] + t * (c1[2] - c0[2])),
      ];
    }
  }
  return [235, 40, 35];
}
