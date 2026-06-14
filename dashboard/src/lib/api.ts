/**
 * Calls to the FastAPI backend (/api/pipeline/* proxied by Next.js).
 */

// When NEXT_PUBLIC_API_URL is set (e.g. a deployed backend on Render), call it
// directly — CORS is open on the API. Otherwise fall back to the Next.js
// rewrite proxy at /api/pipeline (local dev convenience).
const BASE = process.env.NEXT_PUBLIC_API_URL?.trim()
  ? process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")
  : "/api/pipeline";

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

// ---- API version handshake (ApiBanner) ----
// Bump together with API_BUILD in api/main.py when the dashboard starts
// depending on new endpoints.
export const EXPECTED_API_BUILD = 6;

export async function getApiHealth(): Promise<{ status: string; api_build?: number }> {
  const r = await fetch(`${BASE}/health`);   // /health is unauthenticated
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
  shots: { t_s: number; rally: number; player_id: number; pos: [number, number] | null; type: string; outcome?: string; gemini_matched?: boolean }[];
  timings_s: Record<string, number>;
  gemini?: {
    tactics: string;
    summary: string;
    dominant_side: string | null;
    n_rallies: number | null;
    n_strokes: number;
  };
}

export interface GeminiReport {
  tactics: string;
  summary: string;
  dominant_side: string | null;
  n_rallies: number | null;
  n_strokes: number;
  strokes: { t_s: number; player_pos: string; type: string; outcome: string }[];
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
  gemini_report?: GeminiReport;
  gemini_error?: string;
}

export async function getCondenseCapabilities(): Promise<{ analyze: boolean; gemini: boolean; youtube: boolean; max_upload_mb?: number }> {
  const r = await apiFetch(`${BASE}/condense/capabilities`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

type CondenseOpts = { analyze?: boolean; courtId?: string; deep?: boolean; gemini?: boolean };

function condenseFields(opts?: CondenseOpts): FormData {
  const fd = new FormData();
  if (opts?.analyze) {
    fd.append("analyze", "true");
    fd.append("court_id", opts.courtId || "court1");
    if (opts.deep) fd.append("deep", "true");
  }
  if (opts?.gemini) fd.append("gemini", "true");
  return fd;
}

export async function uploadForCondense(
  file: File,
  opts?: CondenseOpts,
): Promise<{ job_id: string }> {
  const fd = condenseFields(opts);
  fd.append("file", file);
  const r = await apiFetch(`${BASE}/condense/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadUrlForCondense(
  url: string,
  opts?: CondenseOpts,
): Promise<{ job_id: string }> {
  const fd = condenseFields(opts);
  fd.append("url", url);
  const r = await apiFetch(`${BASE}/condense/upload-url`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getCondenseStatus(job_id: string): Promise<CondenseStatus> {
  const r = await apiFetch(`${BASE}/condense/${job_id}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function condenseDownloadUrl(job_id: string): string {
  return `${BASE}/condense/${job_id}/download`;
}

// ---- Review & feedback (human-in-the-loop training) ----

export interface ReviewItem {
  ts_ms: number;
  player_id: number;
  stroke_type: string;
  outcome: string | null;
  confidence: number | null;
  audio_onset: boolean | null;
  frame_idx: number | null;
}

export interface ReviewData {
  rid: string;
  items: ReviewItem[];
  previous_corrections: Correction[];
  video_available: boolean;
  stroke_classes: string[];
  gemini: {
    tactics: string;
    summary: string;
    dominant_side: string | null;
    n_rallies: number | null;
    n_strokes: number;
  } | null;
}

export interface Correction {
  ts_ms: number;
  player_id: number;
  verdict: "correct" | "wrong_class" | "not_a_shot" | "missed";
  predicted_type?: string | null;
  corrected_type?: string | null;
  frame_idx?: number | null;
}

export async function getReviewData(rid: string): Promise<ReviewData> {

  const r = await apiFetch(`${BASE}/review/${rid}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function submitReview(
  rid: string,
  corrections: Correction[]
): Promise<{ saved: number; golden_hits: number }> {
  const r = await apiFetch(`${BASE}/review/${rid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ corrections }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function reviewVideoUrl(rid: string): string {
  return `${BASE}/review/${rid}/video`;
}

// ---- Annotation (training data collection) ----

export interface AnnotationData {
  rid: string;
  shots: {
    ts_ms: number;
    player_id: number;
    stroke_type: string;
    pos?: [number, number] | null;
  }[];
  video_available: boolean;
  n_ball_annotations: number;
}

export interface AnnotationSubmission {
  balls: {
    ts_ms: number;
    x_norm: number;
    y_norm: number;
    radius_norm: number;
    frame_w: number;
    frame_h: number;
    court_x?: number | null;
    court_y?: number | null;
  }[];
  outcomes: { ts_ms: number; player_id: number; outcome: string }[];
  player_ids: { ts_ms: number; original_player_id: number; corrected_player_id: number }[];
}

export async function getAnnotationData(rid: string): Promise<AnnotationData> {
  const r = await apiFetch(`${BASE}/annotate/${rid}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getAnnotationFrame(
  rid: string,
  ts_ms: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const r = await apiFetch(`${BASE}/annotate/${rid}/frame?ts_ms=${ts_ms}`);
  if (!r.ok) throw new Error(await r.text());
  const blob = await r.blob();
  const width = Number(r.headers.get("X-Frame-Width")) || 0;
  const height = Number(r.headers.get("X-Frame-Height")) || 0;
  return { blob, width, height };
}

export async function submitAnnotations(
  rid: string,
  body: AnnotationSubmission
): Promise<{ balls: number; outcomes: number; player_ids: number }> {
  const r = await apiFetch(`${BASE}/annotate/${rid}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function triggerBallRetrain(): Promise<{ status: string }> {
  const r = await apiFetch(`${BASE}/annotate/retrain/ball`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function triggerPlayerRetrain(): Promise<{ status: string }> {
  const r = await apiFetch(`${BASE}/annotate/retrain/player`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getAnnotateRetrainStatus(): Promise<Record<string, { status: string; detail?: string; n_samples?: number }>> {
  const r = await apiFetch(`${BASE}/annotate/retrain/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ---- Full-match Gemini report (Part 1) ----

export interface ReportStatus {
  rid: string;
  status: string;            // processing | done | error
  phase?: string;
  filename?: string;
  error?: string;
  condensed_available?: boolean;
}

export interface MatchReport {
  rid: string;
  condensed_available?: boolean;
  duration_s: number;
  final_score: { team1_sets: number; team2_sets: number; detail: string };
  match_summary: string;
  confidence: number;
  shot_counts: Record<string, Record<string, number>>;
  formation_pct: Record<string, number>;
  rally_stats: {
    total_rallies: number;
    avg_duration_s: number;
    total_play_time_s: number;
    play_time_pct: number;
  };
  player_positions: { t_s: number; player: number; court_x: number; court_y: number }[];
  shots: { t_s: number; player: number; type: string; outcome: string }[];
  formation_samples: { t_s: number; type: string }[];
  score_timeline: { t_s: number; team1_games: number; team2_games: number }[];
  key_frames: { t_s: number; n_players: number; ball_visible: boolean; description: string; ball_x_norm?: number; ball_y_norm?: number; ball_conf?: number }[];
  rallies: { start_s: number; end_s: number; num_shots: number; winner_team: 1 | 2 | null }[];
}

export async function uploadForReport(file: File): Promise<{ rid: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await apiFetch(`${BASE}/report/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadUrlForReport(url: string): Promise<{ rid: string }> {
  const fd = new FormData();
  fd.append("url", url);
  const r = await apiFetch(`${BASE}/report/upload-url`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getReportStatus(rid: string): Promise<ReportStatus> {
  const r = await apiFetch(`${BASE}/report/${rid}/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getReport(rid: string): Promise<MatchReport> {
  const r = await apiFetch(`${BASE}/report/${rid}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function reportFrameUrl(rid: string, idx: number): string {
  return `${BASE}/report/${rid}/frames/${idx}`;
}

export function reportTrainingDataUrl(rid: string): string {
  return `${BASE}/report/${rid}/training-data`;
}

export function reportCondensedUrl(rid: string): string {
  return `${BASE}/report/${rid}/condensed`;
}

// ---- Model progression / levels (Part 2) ----

export interface TrainingTrack {
  key: string;
  label: string;
  count: number;
  level: number;
  max_level: number;
  next_at: number | null;
  min_to_train: number | null;
  can_train: boolean;
  thresholds: number[];
  model?: { trained: boolean; weights?: string; metrics?: Record<string, unknown> };
}

export interface TrainingStatus {
  tracks: TrainingTrack[];
  total_images: number;
  match_frames: number;
  overall_count: number;
  overall_level: number;
  max_level: number;
  overall_next_at: number | null;
  thresholds: number[];
  models: Record<string, { trained: boolean; weights?: string; metrics?: Record<string, unknown> }>;
}

export interface TrainingTestResult {
  key: string;
  label: string;
  status: "ready" | "trainable" | "collecting";
  message: string;
  count: number;
  min_to_train: number;
  trained: boolean;
}

export async function getTrainingStatus(): Promise<TrainingStatus> {
  const r = await apiFetch(`${BASE}/training/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getTrainingTest(): Promise<{ results: TrainingTestResult[] }> {
  const r = await apiFetch(`${BASE}/training/test`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
