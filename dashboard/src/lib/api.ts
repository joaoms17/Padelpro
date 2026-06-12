/**
 * Calls to the FastAPI backend (/api/pipeline/* proxied by Next.js).
 */

// When NEXT_PUBLIC_API_URL is set (e.g. a deployed backend on Render), call it
// directly — CORS is open on the API. Otherwise fall back to the Next.js
// rewrite proxy at /api/pipeline (local dev convenience).
const BASE = process.env.NEXT_PUBLIC_API_URL?.trim()
  ? process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")
  : "/api/pipeline";

// ---- Shared access code (set on the API via PADELPRO_ACCESS_CODE) ----
// Stored in localStorage after the first prompt; sent as a header on fetches
// and as ?code= on media URLs (<video src> can't send headers).

const CODE_KEY = "padelpro_access_code";

function getAccessCode(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CODE_KEY) ?? "";
}

export function setAccessCode(code: string): void {
  localStorage.setItem(CODE_KEY, code);
}

export function withCode(url: string): string {
  const code = getAccessCode();
  if (!code) return url;
  return `${url}${url.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`;
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const doFetch = () => {
    const headers = new Headers(init?.headers);
    const code = getAccessCode();
    if (code) headers.set("X-Access-Code", code);
    return fetch(url, { ...init, headers });
  };

  let r = await doFetch();
  if (r.status === 401 && typeof window !== "undefined") {
    const code = window.prompt("Código de acesso do PadelPro:");
    if (code) {
      setAccessCode(code.trim());
      r = await doFetch();
    }
  }
  return r;
}

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
  const r = await apiFetch(`${BASE}/matches/`, {
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
  const r = await apiFetch(`${BASE}/matches/${match_id}/upload`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function runPipeline(
  match_id: string,
  opts: { segment?: boolean; condense?: boolean; pose?: boolean; analytics?: boolean; supabase?: boolean }
): Promise<MatchStatus> {
  const r = await apiFetch(`${BASE}/matches/${match_id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_id, ...opts }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getStatus(match_id: string): Promise<MatchStatus> {
  const r = await apiFetch(`${BASE}/matches/${match_id}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listMatches(): Promise<MatchStatus[]> {
  const r = await apiFetch(`${BASE}/matches/`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getPlayerStats(match_id: string): Promise<PlayerStats[]> {
  const r = await apiFetch(`${BASE}/analytics/matches/${match_id}/stats`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getHeatmap(match_id: string, player_id: number): Promise<number[][]> {
  const r = await apiFetch(`${BASE}/analytics/matches/${match_id}/heatmap/${player_id}`);
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
  const r = await apiFetch(`${BASE}/clips/matches/${match_id}?${params}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function requestMontage(
  match_id: string,
  filters: { player_id?: number; stroke?: string; zone?: string; rally_phase?: string },
  output_name = "montage.mp4"
): Promise<{ job_id: string; clips: number }> {
  const r = await apiFetch(`${BASE}/clips/matches/${match_id}/montage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_id, ...filters, output_name }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getMontageStatus(job_id: string): Promise<{ status: string; output?: string; error?: string }> {
  const r = await apiFetch(`${BASE}/clips/montage/${job_id}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function montageDownloadUrl(job_id: string): string {
  return withCode(`${BASE}/clips/montage/${job_id}/download`);
}

export async function listPlayers(): Promise<PlayerSummary[]> {
  const r = await apiFetch(`${BASE}/analytics/players`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getProgression(player_id: number, metric: string): Promise<ProgressionData> {
  const r = await apiFetch(`${BASE}/analytics/progression/${player_id}/${metric}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ---- Condense ("useful time") ----

export interface PlayerReport {
  id: number;
  label: string;
  team: "longe" | "perto";
  side: "esq" | "dir";
  samples: number;
  coverage_pct: number;
  distance_m: number;
  avg_speed_ms: number;
  max_speed_ms: number;
  active_s: number;
  zones: { rede_pct: number; meio_pct: number; fundo_pct: number; frente_linha_pct: number };
  mean_pos: [number, number];
  heatmap: number[][];
  hits: number;
  hit_share_pct?: number;
  shot_types?: Record<string, number>;
}

export interface ClipReport {
  version: number;
  calibrated: boolean;
  court_id: string;
  clip: { duration_s: number; useful_s: number; useful_pct: number; rallies: number; sampled_fps: number };
  hits: {
    total: number;
    per_min_useful: number;
    avg_per_rally: number;
    attribution: string;
    ball_found_pct?: number | null;
    via_ball_pct?: number | null;
  };
  players: PlayerReport[];
  rallies: { i: number; start_s: number; dur_s: number; hits: number }[];
  shots: { t_s: number; rally: number; player_id: number; pos: [number, number] | null; type: string }[];
  timings_s: Record<string, number>;
}

export interface CondenseStatus {
  job_id: string;
  status: string;            // processing | done | error
  phase?: string;
  progress?: number;
  filename?: string;
  total_s?: number;
  useful_s?: number;
  useful_pct?: number;
  rallies?: number;
  error?: string;
  report?: ClipReport;
  report_error?: string;
}

export async function getCondenseCapabilities(): Promise<{ analyze: boolean; max_upload_mb?: number }> {
  const r = await apiFetch(`${BASE}/condense/capabilities`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadForCondense(
  file: File,
  opts?: { analyze?: boolean; courtId?: string; deep?: boolean },
): Promise<{ job_id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (opts?.analyze) {
    fd.append("analyze", "true");
    fd.append("court_id", opts.courtId || "court1");
    if (opts.deep) fd.append("deep", "true");
  }
  const r = await apiFetch(`${BASE}/condense/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getCondenseStatus(job_id: string): Promise<CondenseStatus> {
  const r = await apiFetch(`${BASE}/condense/${job_id}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function condenseDownloadUrl(job_id: string): string {
  return withCode(`${BASE}/condense/${job_id}/download`);
}

// ---- Review & feedback (human-in-the-loop training) ----

export interface ReviewItem {
  ts_ms: number;
  player_id: number;
  stroke_type: string;
  confidence: number | null;
  audio_onset: boolean | null;
  frame_idx: number | null;
  trainable: boolean;
}

export interface ReviewData {
  rid: string;
  items: ReviewItem[];
  previous_corrections: Correction[];
  video_available: boolean;
  stroke_classes: string[];
}

export interface Correction {
  ts_ms: number;
  player_id: number;
  verdict: "correct" | "wrong_class" | "not_a_shot" | "missed";
  predicted_type?: string | null;
  corrected_type?: string | null;
  frame_idx?: number | null;
}

export interface RetrainStatus {
  status: "idle" | "running" | "ok" | "skipped" | "error";
  detail?: string;
  n_samples?: number;
}

export async function getReviewData(rid: string): Promise<ReviewData> {
  const r = await apiFetch(`${BASE}/review/${rid}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function submitReview(
  rid: string,
  corrections: Correction[]
): Promise<{ saved: number; training_samples: number; golden_hits: number }> {
  const r = await apiFetch(`${BASE}/review/${rid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ corrections }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function triggerRetrain(rid: string): Promise<{ status: string }> {
  const r = await apiFetch(`${BASE}/review/${rid}/retrain`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getRetrainStatus(): Promise<RetrainStatus> {
  const r = await apiFetch(`${BASE}/review/retrain/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function reviewVideoUrl(rid: string): string {
  return withCode(`${BASE}/review/${rid}/video`);
}

// ---- Clip labelling (dataset building) ----

export interface LabelQueue {
  root: string;
  labels: string[];
  clips: { name: string; label: string | null }[];
  counts: Record<string, number>;
  n_unlabelled: number;
}

export async function getLabelQueue(): Promise<LabelQueue> {
  const r = await apiFetch(`${BASE}/label/queue`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function labelClip(name: string, label: string): Promise<{ moved: boolean }> {
  const r = await apiFetch(`${BASE}/label/clip/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function labelClipUrl(name: string): string {
  return withCode(`${BASE}/label/clip/${encodeURIComponent(name)}`);
}

// ---- Fleet quality ----

export interface QualityReport {
  match_id: string;
  generated_at: number;
  detection?: {
    frames_processed: number;
    mean_detection_confidence: number;
    mean_players_per_frame: number;
    pct_frames_with_expected_players: number;
    pct_frames_with_zero_players: number;
  };
  tracking?: {
    n_tracks: number;
    tracks_per_minute: number;
    avg_track_duration_s: number;
    pct_time_with_expected_players: number;
  };
  physics?: {
    pct_implausible_speed: number;
    max_observed_speed_ms: number;
    teleport_count: number;
    pct_out_of_court: number;
  } | null;
  strokes?: {
    n_events: number;
    mean_confidence: number;
    pct_with_audio_onset: number;
  };
  performance?: {
    elapsed_s: number;
    realtime_factor: number;
  };
  homography_quality?: { rating: string; reprojection_error_px: number | null } | null;
}

export interface FleetQuality {
  n_matches: number;
  summary: Record<string, number>;
  reports: QualityReport[];
}

export async function getFleetQuality(): Promise<FleetQuality> {
  const r = await apiFetch(`${BASE}/quality/`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ---- Court calibration ----

export async function autoDetectCorners(
  image: Blob
): Promise<{ points: number[][]; quality: { rating: string; reprojection_error_px: number | null } }> {
  const fd = new FormData();
  fd.append("file", image, "frame.jpg");
  const r = await apiFetch(`${BASE}/calibrate/auto`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveCalibration(
  court_id: string,
  points: number[][],
  frame_width: number,
  frame_height: number,
): Promise<{ court_id: string; saved: boolean }> {
  const r = await apiFetch(`${BASE}/calibrate/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ court_id, points, frame_width, frame_height }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
