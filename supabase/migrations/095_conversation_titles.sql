-- 095: conversation_titles - one warm, member-editable title per Riley conversation (session).
--
-- WHY a separate table (not riley_conversations.title): a conversation is a SESSION, not a
-- message. riley_conversations stores one row per message; there is no per-session record to
-- hang a single canonical title + an "edited" flag on. (The vestigial title/preview/tags columns
-- on riley_conversations are unused - 0 rows populated - and smearing a title across every
-- message row of a session is incoherent.) This table is the per-conversation record: keyed by
-- (user_id, session_id), it holds the title Riley auto-generates after the fact PLUS a
-- title_edited flag so a member's own rename is NEVER auto-overwritten by a later regeneration.
--
-- Lifecycle:
--   conversations.html lists sessions -> for any untitled session it fires conversation-title.js
--   (fire-and-forget). That function reads the first several messages, generates ONE warm,
--   specific title via the utility model (Haiku), and upserts a row here with title_edited=false.
--   A member can rename inline (pencil) -> upsert with title_edited=true, which the generator
--   then refuses to touch. Erased on account deletion via ACCOUNT_DELETE_TABLES (no auth.users FK,
--   matching the rest of the schema).
create table if not exists public.conversation_titles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  session_id  text not null,
  title       text not null,
  title_edited boolean not null default false,   -- true = member set it; generator must never overwrite
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, session_id)
);

create index if not exists conversation_titles_user_session_idx
  on public.conversation_titles (user_id, session_id);

-- Riley-internal: all reads/writes go through service-role functions (conversation-title.js),
-- which scope every query to the token-verified user (IDOR-guarded). No anon/client access needed,
-- so RLS is enabled with no policies (deny-by-default for the anon/publishable key).
alter table public.conversation_titles enable row level security;
