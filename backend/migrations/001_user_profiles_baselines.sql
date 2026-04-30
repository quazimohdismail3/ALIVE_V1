-- 001_user_profiles_baselines.sql
-- Phase P1 — Mission Alive H10 Gold Standard
-- Adds profile + baseline + auxiliary tables. Extends sessions with
-- baseline-related columns. RLS enforced everywhere.
--
-- Constraint: free-tier prod (no Supabase preview branches available, $25/mo
-- Pro plan not active). All statements MUST be idempotent and non-destructive
-- — no DROPs of any kind. CREATE TABLE uses `if not exists`. ALTER uses
-- `add column if not exists`. CREATE POLICY is wrapped in
-- `do $$ ... exception when duplicate_object then null; end $$` because
-- Postgres lacks `create policy if not exists` until v17.
-- See: docs/superpowers/plans/2026-04-30-p1-supabase-profile.md

-- 1. user_profiles
create table if not exists public.user_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  age        int  not null check (age between 13 and 100),
  sex        text not null check (sex in ('male','female','prefer_not_to_say')),
  height_cm  int  not null check (height_cm between 100 and 230),
  weight_kg  numeric(5,2),
  resting_hr int check (resting_hr between 30 and 120),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$ begin
  alter table public.user_profiles
    add constraint user_profiles_weight_kg_check
    check (weight_kg is null or (weight_kg between 30 and 300));
exception when duplicate_object then null; end $$;

-- 2. user_baselines
create table if not exists public.user_baselines (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  rmssd_mean           numeric(6,2) not null,
  rmssd_sd             numeric(6,2) not null,
  rmssd_min            numeric(6,2) not null,
  rmssd_max            numeric(6,2) not null,
  hr_rest_mean         numeric(5,2),
  source               text not null check (source in ('cold_start','blended','personal')),
  n_sessions_used      int not null default 0,
  posterior_precision  numeric(10,4) not null,
  window_start         timestamptz,
  updated_at           timestamptz default now()
);

-- 3. ALTER existing sessions to add baseline-related columns
alter table public.sessions
  add column if not exists rmssd_start              numeric(6,2),
  add column if not exists rmssd_end                numeric(6,2),
  add column if not exists rmssd_median             numeric(6,2),
  add column if not exists rmssd_z                  numeric(5,2),
  add column if not exists recovery_score           int check (recovery_score between 0 and 100),
  add column if not exists hr_mean                  numeric(5,2),
  add column if not exists arousal_start            numeric(4,3),
  add column if not exists arousal_end              numeric(4,3),
  add column if not exists dominant_state           text,
  add column if not exists state_distribution       jsonb,
  add column if not exists artifact_rate            numeric(4,3),
  add column if not exists mean_sqi                 numeric(4,3),
  add column if not exists hr_drift_bpm             numeric(5,2),
  add column if not exists baseline_eligible        boolean not null default false,
  add column if not exists baseline_excluded_reason text,
  add column if not exists baseline_weight          numeric(4,3),
  add column if not exists post_mood                int check (post_mood between 1 and 5);

-- 4. session_rr_segments (waveform drill-down)
create table if not exists public.session_rr_segments (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  t_offset_s int  not null,
  rr_chunk   jsonb not null,
  primary key (session_id, t_offset_s)
);

-- 5. session_metric_snapshots (per-cycle JSON for stats charts)
create table if not exists public.session_metric_snapshots (
  session_id   uuid not null references public.sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  t_offset_s   int  not null,
  metrics_json jsonb not null,
  state_json   jsonb,
  params_json  jsonb,
  primary key (session_id, t_offset_s)
);

-- 6. insight_events
create table if not exists public.insight_events (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete cascade,
  rule_id    text not null,
  payload    jsonb not null,
  rendered   text not null,
  created_at timestamptz default now()
);
create index if not exists insight_events_user_time
  on public.insight_events(user_id, created_at desc);

-- 7. RLS — enable
alter table public.user_profiles            enable row level security;
alter table public.user_baselines           enable row level security;
alter table public.session_rr_segments      enable row level security;
alter table public.session_metric_snapshots enable row level security;
alter table public.insight_events           enable row level security;

-- 8. RLS policies — own-row only

do $$ begin
  create policy user_profiles_select on public.user_profiles
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_profiles_insert on public.user_profiles
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_profiles_update on public.user_profiles
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_profiles_delete on public.user_profiles
    for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_baselines_select on public.user_baselines
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_baselines_insert on public.user_baselines
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_baselines_update on public.user_baselines
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_baselines_delete on public.user_baselines
    for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy session_rr_segments_select on public.session_rr_segments
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy session_rr_segments_insert on public.session_rr_segments
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy session_metric_snapshots_select on public.session_metric_snapshots
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy session_metric_snapshots_insert on public.session_metric_snapshots
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy insight_events_select on public.insight_events
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy insight_events_insert on public.insight_events
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
