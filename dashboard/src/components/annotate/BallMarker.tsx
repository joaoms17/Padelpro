"use client";

import { useRef } from "react";

export type Ball = { x_norm: number; y_norm: number; radius_norm: number };

/**
 * Large frame image with a click-to-place ball overlay.
 *
 * Click coordinates are converted to normalised [0..1] using the *rendered*
 * image rect (getBoundingClientRect), so they're independent of the displayed
 * size. The natural frame dimensions are stored separately by the parent
 * (frame_w/frame_h) — those come from getAnnotationFrame.
 */
export function BallMarker({
  src,
  ball,
  disabled,
  onPlace,
}: {
  src: string | null;
  ball: Ball | null | undefined;
  disabled?: boolean;
  onPlace: (b: Ball) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  function place(clientX: number, clientY: number) {
    if (disabled) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    // radius relative to the smaller image dimension; default ~2.2%
    onPlace({ x_norm: x, y_norm: y, radius_norm: 0.022 });
  }

  if (!src) {
    return (
      <div className="aspect-video w-full rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 grid place-items-center text-center px-6">
        <div className="space-y-1">
          <p className="text-sm text-gray-300">Frame não disponível</p>
          <p className="text-xs text-gray-500">
            O vídeo pode ter expirado. Ainda podes confirmar jogador e resultado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      onClick={(e) => place(e.clientX, e.clientY)}
      className={`relative w-full overflow-hidden rounded-2xl border border-gray-700 bg-black select-none ${
        disabled ? "" : "cursor-crosshair"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Frame da batida" className="block w-full h-auto" draggable={false} />

      {ball && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${ball.x_norm * 100}%`,
            top: `${ball.y_norm * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          {/* outer glow ring */}
          <span
            className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: 34,
              height: 34,
              boxShadow: "0 0 0 2px #E8FF3D, 0 0 18px 4px rgba(232,255,61,0.45)",
              background: "rgba(232,255,61,0.18)",
            }}
          />
          {/* core dot */}
          <span
            className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ width: 10, height: 10, background: "#E8FF3D" }}
          />
        </div>
      )}

      {!ball && !disabled && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-accent">
          Clica na bola
        </div>
      )}
    </div>
  );
}
