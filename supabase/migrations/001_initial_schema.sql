-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- Profiles (auto-created on signup via trigger)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text default 'UTC',
  participant_code text unique,
  study_id text,
  onboarded boolean default false,
  created_at timestamptz default now()
);

-- Sessions
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  session_type text not null,
  mode integer not null,
  device_label text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_s integer,
  discarded boolean default false,
  rf_bpm float,
  rf_locked boolean default false,
  rf_lock_epoch_s integer,
  peak_vs float,
  final_vs float,
  skill_transfer_score float,
  arc_phases_completed integer default 0,
  circadian_phase text,
  circadian_fit_score float,
  rr_total integer,
  rr_rejected integer,
  sqi_mean float,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- HRV snapshots (1 Hz)
create table if not exists public.hrv_snapshots (
  id bigserial primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  ts timestamptz not null,
  epoch_s integer not null,
  rmssd float, sdnn float, lf_hf float, dfa_a1 float,
  svi float, poincare_sd1 float, poincare_sd2 float,
  vs_score float, ans_state text, arc_phase text,
  rf_coherence float, rf_locked boolean,
  ls_arousal float, ls_valence float, ls_regulation float, ls_engagement float
);

-- Raw RR intervals
create table if not exists public.rr_intervals (
  id bigserial primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  ts timestamptz not null,
  rr_ms float not null,
  accepted boolean not null,
  source text
);

-- Session events
create table if not exists public.session_events (
  id bigserial primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  ts timestamptz not null,
  epoch_s integer not null,
  event_type text not null,
  payload jsonb
);

-- RF calibration history
create table if not exists public.rf_calibration (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id uuid references public.sessions(id) on delete cascade,
  measured_at timestamptz default now(),
  rf_bpm float not null,
  confidence float,
  prior_mean float,
  prior_std float
);

-- Indexes
create index if not exists idx_sessions_user_time on public.sessions(user_id, started_at desc);
create index if not exists idx_hrv_session_epoch on public.hrv_snapshots(session_id, epoch_s);
create index if not exists idx_rr_session_ts on public.rr_intervals(session_id, ts);
create index if not exists idx_events_session_ts on public.session_events(session_id, ts);
create index if not exists idx_rf_user_time on public.rf_calibration(user_id, measured_at desc);

-- RLS
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.hrv_snapshots enable row level security;
alter table public.rr_intervals enable row level security;
alter table public.session_events enable row level security;
alter table public.rf_calibration enable row level security;

drop policy if exists "own data" on public.profiles;
drop policy if exists "own data" on public.sessions;
drop policy if exists "own data" on public.hrv_snapshots;
drop policy if exists "own data" on public.rr_intervals;
drop policy if exists "own data" on public.session_events;
drop policy if exists "own data" on public.rf_calibration;

create policy "own data" on public.profiles
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "own data" on public.sessions
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own data" on public.hrv_snapshots
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own data" on public.rr_intervals
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own data" on public.session_events
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own data" on public.rf_calibration
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
