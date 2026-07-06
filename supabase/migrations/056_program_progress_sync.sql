-- 056_program_progress_sync.sql
-- DATA INTEGRITY PASS — Wave 2 (program progress).
-- user_program_progress carries three legacy/canonical column pairs from a rename:
--   day_completed  (legacy)  ↔ days_completed   (canonical)
--   started_at     (legacy)  ↔ enrolled_at      (canonical)
--   last_activity  (legacy)  ↔ last_activity_at (canonical)
-- Reads fall back `days_completed ?? day_completed`, and both were written together —
-- which silently breaks the moment a writer touches only one. This makes the DB keep
-- them in lockstep: canonical is the source of truth, legacy is an enforced mirror,
-- so BOTH old and new readers always agree no matter which column a writer sets.
-- Idempotent.

create or replace function public.mirror_program_progress_legacy()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Seed canonical from legacy for any writer/row that only set the old columns…
  if NEW.days_completed   is null then NEW.days_completed   := NEW.day_completed; end if;
  if NEW.enrolled_at      is null then NEW.enrolled_at      := NEW.started_at;    end if;
  if NEW.last_activity_at is null then NEW.last_activity_at := NEW.last_activity;  end if;
  -- …then always mirror canonical -> legacy so fallback readers stay correct.
  NEW.day_completed := NEW.days_completed;
  NEW.started_at    := NEW.enrolled_at;
  NEW.last_activity := NEW.last_activity_at;
  return NEW;
end $$;

drop trigger if exists trg_mirror_program_progress on public.user_program_progress;
create trigger trg_mirror_program_progress
  before insert or update on public.user_program_progress
  for each row execute function public.mirror_program_progress_legacy();

-- Backfill existing rows: canonical from legacy where missing, then legacy from canonical.
update public.user_program_progress
   set days_completed   = coalesce(days_completed, day_completed),
       enrolled_at      = coalesce(enrolled_at, started_at),
       last_activity_at = coalesce(last_activity_at, last_activity);
update public.user_program_progress
   set day_completed = days_completed,
       started_at    = enrolled_at,
       last_activity = last_activity_at;
