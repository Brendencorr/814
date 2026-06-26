-- Add format_winner and worst_pillar to echo_scores
alter table echo_scores
  add column if not exists format_winner text,
  add column if not exists worst_pillar  text;

-- Add buffer_update_id to published_posts
alter table published_posts
  add column if not exists buffer_update_id text;

-- Pipeline run log
create table if not exists pipeline_runs (
  id                    uuid default gen_random_uuid() primary key,
  run_date              date not null,
  status                text not null default 'running',
  scout_topics_count    integer default 0,
  sage_posts_count      integer default 0,
  buffer_posts_scheduled integer default 0,
  echo_top_pillar       text,
  echo_format_winner    text,
  error_message         text,
  created_at            timestamp default now()
);
