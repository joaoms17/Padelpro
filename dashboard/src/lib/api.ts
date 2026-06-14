/**
 * Calls to the FastAPI backend (/api/pipeline/* proxied by Next.js).
 */

const BASE = "/api/pipeline";

export interface MatchStatus {
  match_id: string;
  status: string;
  error_message?: string | null;
  progress?: string | null;
}

export interface AnalysisReport {
  match_id: string;
  duration_s: number;
  final_score: { team1_sets: number; team2_sets: number; detail: string };
  shot_counts: Record<string, Record<string, number>>;
  match_summary: string;
  confidence: number;
  formation_pct: { both_net: number; both_back: number; t1_net_t2_back: number; t1_back_t2_net: number; mixed: number };
  player_positions: Array<{ time_s: number; player: number; court_x: number; court_y: number }>;
  shots: Array<{ time_s: number; player: number; type: string; outcome: string }>;
  score_timeline: Array<{ time_s: number; team1_games: number; team2_games: number; team1_points: string; team2_points: string }>;
  key_frames: Array<{ time_s: number; description: string; all_players_visible: boolean; ball_visible: boolean }>;
}

export async function createMatch(youtube_url?: string): Promise<MatchStatus> {
  const body: { court_id: string; youtube_url?: string } = { court_id: "default" };
  if (youtube_url) body.youtube_url = youtube_url;
  const r = await fetch(`${BASE}/matches/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadVideo(match_id: string, file: File): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${BASE}/matches/${match_id}/upload`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function getStatus(match_id: string): Promise<MatchStatus> {
  const r = await fetch(`${BASE}/matches/${match_id}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listMatches(): Promise<MatchStatus[]> {
  const r = await fetch(`${BASE}/matches/`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getReport(match_id: string): Promise<AnalysisReport> {
  const r = await fetch(`${BASE}/report/${match_id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function frameUrl(match_id: string, frame_idx: number): string {
  return `${BASE}/report/${match_id}/frames/${frame_idx}`;
}

export function trainingDataUrl(match_id: string): string {
  return `${BASE}/report/${match_id}/training-data`;
}
