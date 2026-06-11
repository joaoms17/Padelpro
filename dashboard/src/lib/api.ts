/**
 * Calls to the FastAPI backend (/api/pipeline/* proxied by Next.js).
 */

// When NEXT_PUBLIC_API_URL is set (e.g. a deployed backend on Render), call it
// directly — CORS is open on the API. Otherwise fall back to the Next.js
// rewrite proxy at /api/pipeline (local dev convenience).
const BASE = process.env.NEXT_PUBLIC_API_URL?.trim()
  ? process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")
  : "/api/pipeline";

export interface MatchStatus {
  match_id: string;
  status: string;
  error_message?: string | null;
}

export interface PlayerStats {
  player_id: number;
  distance_m: number;
  avg_speed_ms: number;
  max_speed_ms: number;
  attack_pct: number;
  defense_pct: number;
  transition_pct: number;
  shots: Record<string, number>;
  sync_score: number;
}

export interface Clip {
  clip_id: number;
  player_id: number;
  stroke_type: string;
  zone: string;
  rally_phase: string;
  t_start_ms: number;
  t_end_ms: number;
  thumbnail_url: string | null;
}

export interface PlayerSummary {
  player_id: number;
  match_count: number;
  match_id?: string;
  distance_m?: number;
  avg_speed_ms?: number;
  max_speed_ms?: number;
  attack_pct?: number;
  defense_pct?: number;
  transition_pct?: number;
}

export interface ProgressionPoint {
  measured_at: string;
  value: number;
  match_id: string | null;
}

export interface ProgressionData {
  player_id: string;
  metric: string;
  history: ProgressionPoint[];
}

export async function createMatch(court_id: string): Promise<MatchStatus> {
  const r = await fetch(`${BASE}/matches/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ court_id }),
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

export async function runPipeline(
  match_id: string,
  opts: { segment?: boolean; condense?: boolean; pose?: boolean; analytics?: boolean; supabase?: boolean }
): Promise<MatchStatus> {
  const r = await fetch(`${BASE}/matches/${match_id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_id, ...opts }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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

export async function getPlayerStats(match_id: string): Promise<PlayerStats[]> {
  const r = await fetch(`${BASE}/analytics/matches/${match_id}/stats`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getHeatmap(match_id: string, player_id: number): Promise<number[][]> {
  const r = await fetch(`${BASE}/analytics/matches/${match_id}/heatmap/${player_id}`);
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data.heatmap;
}

export async function queryClips(
  match_id: string,
  filters: { player_id?: number; stroke?: string; zone?: string; rally_phase?: string }
): Promise<Clip[]> {
  const params = new URLSearchParams();
  if (filters.player_id != null) params.set("player_id", String(filters.player_id));
  if (filters.stroke)      params.set("stroke",    filters.stroke);
  if (filters.zone)        params.set("zone",       filters.zone);
  if (filters.rally_phase) params.set("rally_phase", filters.rally_phase);
  const r = await fetch(`${BASE}/clips/matches/${match_id}?${params}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function requestMontage(
  match_id: string,
  filters: { player_id?: number; stroke?: string; zone?: string; rally_phase?: string },
  output_name = "montage.mp4"
): Promise<{ job_id: string; clips: number }> {
  const r = await fetch(`${BASE}/clips/matches/${match_id}/montage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_id, ...filters, output_name }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getMontageStatus(job_id: string): Promise<{ status: string; output?: string; error?: string }> {
  const r = await fetch(`${BASE}/clips/montage/${job_id}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function montageDownloadUrl(job_id: string): string {
  return `${BASE}/clips/montage/${job_id}/download`;
}

export async function listPlayers(): Promise<PlayerSummary[]> {
  const r = await fetch(`${BASE}/analytics/players`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getProgression(player_id: number, metric: string): Promise<ProgressionData> {
  const r = await fetch(`${BASE}/analytics/progression/${player_id}/${metric}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ---- Condense ("useful time") ----

export interface CondenseStatus {
  job_id: string;
  status: string;            // processing | done | error
  filename?: string;
  total_s?: number;
  useful_s?: number;
  useful_pct?: number;
  rallies?: number;
  error?: string;
}

export async function uploadForCondense(file: File): Promise<{ job_id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${BASE}/condense/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getCondenseStatus(job_id: string): Promise<CondenseStatus> {
  const r = await fetch(`${BASE}/condense/${job_id}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function condenseDownloadUrl(job_id: string): string {
  return `${BASE}/condense/${job_id}/download`;
}

// ---- Court calibration ----

export async function saveCalibration(
  court_id: string,
  points: number[][],
  frame_width: number,
  frame_height: number,
): Promise<{ court_id: string; saved: boolean }> {
  const r = await fetch(`${BASE}/calibrate/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ court_id, points, frame_width, frame_height }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
