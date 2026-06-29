-- Store the full Sage output in pipeline_runs so the review screen
-- can display complete posts (full captions, all slides, hashtags)
alter table pipeline_runs
  add column if not exists sage_output text;
