-- phase-8a.sql — Conditions logging on sessions.
--
-- Adds four optional fields to public.sessions so each session can record
-- the wind, weather, and surface the punter was kicking in. All four
-- columns are nullable so existing rows + sessions where Riley didn't
-- bother to log the weather still work fine.
--
-- Phase 7 triggers do not touch these columns, so they remain editable
-- after the session is finished -- you can back-fill conditions later.

alter table public.sessions
  add column if not exists wind_mph       integer,
  add column if not exists wind_direction text check (wind_direction in ('into','with','cross')),
  add column if not exists weather        text check (weather in ('clear','cloudy','rain','wet')),
  add column if not exists surface        text check (surface in ('turf','grass','wet_grass'));
