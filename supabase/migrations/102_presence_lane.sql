-- 102_presence_lane.sql
-- Clarity v2.4 Amendment (docs/07A): the Presence lane (grief) + insight nudges. Additive.
-- "Presence." - canon echo: "Presence outlasts loss." Internal key lane_presence.

-- Check-in element for lane members only: "kept the ritual" - counted, never described, never graded.
alter table public.daily_checkins
  add column if not exists kept_ritual boolean;

-- Lane registry row (086 pattern). scored=true: the lane scores SHOWING UP (occurrence density);
-- grief itself is never graded - there is no grieving correctly.
insert into public.clarity_dims (dim, layer, label, scored, default_on, weight_hint)
values ('lane_presence', 'practice', 'Presence', true, false, 12)
on conflict (dim) do nothing;

-- Events (presence_lane_enabled/disabled, presence_qualifying_day, insight_nudge_shown/engaged)
-- use the existing canonical events table - no schema needed.
