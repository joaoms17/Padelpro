"use client";

import { useState } from "react";
import { reportFrameUrl, type MatchReport } from "@/lib/api";

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function FrameTile({
  rid,
  idx,
  frame,
}: {
  rid: string;
  idx: number;
  frame: MatchReport["key_frames"][number];
}) {
  const [broken, setBroken] = useState(false);

  const hasBallPos =
    frame.ball_x_norm != null && frame.ball_y_norm != null && !broken;
  const ballConf = frame.ball_conf ?? null;

  return (
    <div className="card overflow-hidden">
      <div className="relative aspect-video bg-navy-800">
        {!broken && (
          <img
            src={reportFrameUrl(rid, idx)}
            alt={frame.description || `Momento ${formatTime(frame.t_s)}`}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        )}
        {hasBallPos && (
          <div
            className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${(frame.ball_x_norm ?? 0) * 100}%`,
              top: `${(frame.ball_y_norm ?? 0) * 100}%`,
            }}
          >
            <div className="w-full h-full rounded-full border-2 border-yellow-300 shadow-[0_0_6px_rgba(234,179,8,0.8)]" />
          </div>
        )}
        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-navy-950/80 text-gray-200 text-xs font-mono tabular-nums">
          {formatTime(frame.t_s)}
        </span>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {frame.n_players >= 4 && <span className="tag-insight">4 jogadores</span>}
          {frame.ball_visible && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold bg-accent-soft text-accent border border-accent/30">
              bola
            </span>
          )}
          {ballConf != null && ballConf >= 0.3 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-accent border border-accent/30 bg-accent-soft">
              IA: {Math.round(ballConf * 100)}%
            </span>
          )}
        </div>
        {frame.description && (
          <p className="text-xs text-gray-400 leading-relaxed">{frame.description}</p>
        )}
      </div>
    </div>
  );
}

export function KeyFramesGallery({ report }: { report: MatchReport }) {
  const frames = report.key_frames ?? [];

  if (frames.length === 0) {
    return <div className="text-gray-400 text-sm">Sem momentos-chave.</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {frames.map((frame, idx) => (
        <FrameTile key={idx} rid={report.rid} idx={idx} frame={frame} />
      ))}
    </div>
  );
}
