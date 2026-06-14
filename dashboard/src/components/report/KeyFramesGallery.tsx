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
