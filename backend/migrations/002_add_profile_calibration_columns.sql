-- 002_add_profile_calibration_columns.sql
-- Adds RF calibration columns to user_profiles that were missing from 001.
-- Idempotent: add column if not exists.

alter table public.user_profiles
  add column if not exists calibration_done bool not null default false,
  add column if not exists rf_bpm numeric(5,2),
  add column if not exists rf_confidence_tag text;
