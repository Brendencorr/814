-- 103_store_birthdate.sql
-- Founder decision 2026-07-23: keep the birthdate entered at the 18+ gate (supersedes 088's
-- discard-after-attestation design). Rationale: members already tell us their DOB once - Riley
-- should know their age without ever asking twice. HARD LINES (unchanged): age is NEVER an input
-- to Clarity scoring or any demographic audit (docs/07 §14 fairness-by-architecture, narrowed to
-- "never scored, never audited"), and a denied minor's birthdate is never stored.
alter table public.user_profiles
  add column if not exists date_of_birth date;
comment on column public.user_profiles.date_of_birth is
  'From the onboarding 18+ gate (kept since 2026-07-23, founder call). Personalization only - never used in Clarity scoring or audits. Member-deletable.';
