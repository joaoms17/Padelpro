-- PadelPro Vision — Initial Schema
-- Apply via Supabase dashboard (SQL editor) or CLI: supabase db push
-- All upserts use ON CONFLICT with explicit columns — no duplicates on reprocess.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- Clubs & Courts
-- ============================================================
create table if not exists clubs (
    id      uuid primary key default uuid_generate_v4(),
    name    text not null,
    created_at timestamptz default now()
);

create table if not exists courts (
    id               uuid primary key default uuid_generate_v4(),
    club_id          uuid references clubs(id) on delete cascade,
    name             text not null,
    homography_json  jsonb,          -- cached H matrix (3×3)
    camera_config    jsonb,          -- height, focal length, etc.
    created_at       timestamptz default now()
);

-- ============================================================
-- Players
-- ============================================================
create table if not exists players (
    id       uuid primary key default uuid_generate_v4(),
    club_id  uuid references clubs(id) on delete set null,
    name     text not null,
    level    text,                   -- iniciante | intermédio | avançado
    created_at timestamptz default now()
);

-- ============================================================
-- Matches
-- ============================================================
create type match_status as enum (
    'queued', 'segmenting', 'processing', 'done', 'error'
);

create table if not exists matches (
    id              uuid primary key default uuid_generate_v4(),
    court_id        uuid references courts(id) on delete set null,
    video_url       text,            -- storage path / URL
    condensed_url   text,            -- condensed video path
    played_at       timestamptz,
    status          match_status default 'queued',
    error_message   text,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

create table if not exists match_players (
    match_id   uuid references matches(id) on delete cascade,
    player_id  uuid references players(id) on delete cascade,
    team       int  not null check (team in (0, 1)),  -- 0 or 1
    slot       int  not null check (slot between 1 and 4),
    primary key (match_id, player_id)
);

-- ============================================================
-- Segmentation
-- ============================================================
create table if not exists segments (
    id        uuid primary key default uuid_generate_v4(),
    match_id  uuid references matches(id) on delete cascade,
    start_ms  double precision not null,
    end_ms    double precision not null,
    type      text not null check (type in ('rally', 'break')),
    unique (match_id, start_ms)
);

-- timestamp_map stored as JSON in matches.condensed_url or a separate column
alter table matches
    add column if not exists timestamp_map_json jsonb;

-- ============================================================
-- Analysis — player_stats
-- ============================================================
create table if not exists player_stats (
    id              uuid primary key default uuid_generate_v4(),
    match_id        uuid references matches(id) on delete cascade,
    player_id       int  not null,   -- ByteTrack track_id (link to players via match_players)
    distance_m      double precision,
    avg_speed_ms    double precision,
    max_speed_ms    double precision,
    attack_pct      double precision,
    defense_pct     double precision,
    transition_pct  double precision,
    shots_json      jsonb,           -- {stroke_type: count}
    heatmap_json    jsonb,           -- [[float,...],...]  normalised grid
    sync_score      double precision,
    created_at      timestamptz default now(),
    unique (match_id, player_id)
);

-- ============================================================
-- Analysis — shot_events
-- ============================================================
create table if not exists shot_events (
    id           uuid primary key default uuid_generate_v4(),
    match_id     uuid references matches(id) on delete cascade,
    player_id    int  not null,
    rally_id     int,
    ts_ms        double precision not null,
    stroke_type  text not null,
    confidence   double precision,
    frame_idx    int,
    court_x      double precision,   -- metres from top-left corner
    court_y      double precision,
    unique (match_id, player_id, ts_ms)
);

create index if not exists shot_events_match_id  on shot_events(match_id);
create index if not exists shot_events_player_id on shot_events(player_id);
create index if not exists shot_events_stroke     on shot_events(stroke_type);

-- ============================================================
-- Indexing — rallies
-- ============================================================
create table if not exists rallies (
    id           uuid primary key default uuid_generate_v4(),
    match_id     uuid references matches(id) on delete cascade,
    rally_id     int  not null,
    start_ms     double precision not null,
    end_ms       double precision not null,
    num_shots    int  default 0,
    winner_team  int,                -- NULL until V2
    unique (match_id, start_ms)
);

-- ============================================================
-- Indexing — clips
-- ============================================================
create table if not exists clips (
    id            uuid primary key default uuid_generate_v4(),
    match_id      uuid references matches(id) on delete cascade,
    rally_id      int,
    player_id     int  not null,
    stroke_type   text,
    t_start_ms    double precision not null,
    t_end_ms      double precision not null,
    zone          text,              -- net_left|net_right|mid_left|mid_right|back_left|back_right
    rally_phase   text,              -- early|mid|late
    thumbnail_url text,
    unique (match_id, player_id, t_start_ms)
);

create index if not exists clips_match_id    on clips(match_id);
create index if not exists clips_player_id   on clips(player_id);
create index if not exists clips_stroke_type on clips(stroke_type);
create index if not exists clips_zone        on clips(zone);

-- ============================================================
-- Progression (diferencial — cross-session)
-- ============================================================
create table if not exists progression (
    id          uuid primary key default uuid_generate_v4(),
    player_id   uuid references players(id) on delete cascade,
    metric      text not null,       -- distance_m | avg_speed_ms | attack_pct | ...
    value       double precision not null,
    measured_at timestamptz not null,
    match_id    uuid references matches(id) on delete set null,
    unique (player_id, metric, measured_at)
);

create index if not exists progression_player_metric on progression(player_id, metric);

-- ============================================================
-- Row Level Security (RLS) — enable but allow all for now
-- Tighten when auth is added (e.g. club_id = auth.uid())
-- ============================================================
alter table clubs        enable row level security;
alter table courts       enable row level security;
alter table players      enable row level security;
alter table matches      enable row level security;
alter table match_players enable row level security;
alter table segments     enable row level security;
alter table player_stats enable row level security;
alter table shot_events  enable row level security;
alter table rallies      enable row level security;
alter table clips        enable row level security;
alter table progression  enable row level security;

-- Service-role bypass (pipeline writes)
create policy "service_all" on clubs        for all using (true);
create policy "service_all" on courts       for all using (true);
create policy "service_all" on players      for all using (true);
create policy "service_all" on matches      for all using (true);
create policy "service_all" on match_players for all using (true);
create policy "service_all" on segments     for all using (true);
create policy "service_all" on player_stats for all using (true);
create policy "service_all" on shot_events  for all using (true);
create policy "service_all" on rallies      for all using (true);
create policy "service_all" on clips        for all using (true);
create policy "service_all" on progression  for all using (true);

-- ============================================================
-- updated_at trigger for matches
-- ============================================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger matches_updated_at
before update on matches
for each row execute function update_updated_at();
