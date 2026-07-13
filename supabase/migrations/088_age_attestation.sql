-- 088_age_attestation.sql
-- H-2 compliance fix: enforce the 18+ representation that lives in ToS and Privacy.
-- Onboarding now collects date of birth ONLY to confirm the member is 18 or older.
-- We DO NOT persist the birthdate itself - only the fact of the confirmation
-- (age_18_plus) and when it was made (age_attested_at), stamped alongside
-- consent_at / consent_version on the same user_profiles row.

alter table public.user_profiles
  add column if not exists age_attested_at timestamptz;
alter table public.user_profiles
  add column if not exists age_18_plus boolean;

comment on column public.user_profiles.age_attested_at is
  'When the member affirmed their date of birth at the onboarding 18+ gate. The birthdate itself is intentionally not stored.';
comment on column public.user_profiles.age_18_plus is
  'Result of the onboarding 18+ date-of-birth gate. true = attested adult (proceeded); false = self-identified minor (denied, no account granted).';
