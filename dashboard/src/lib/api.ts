/**
 * Calls to the FastAPI backend (/api/pipeline/* proxied by Next.js).
 */

const BASE = "/api/pipeline";

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
