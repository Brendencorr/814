create table if not exists scout_history (
  id uuid default gen_random_uuid() primary key,
  week_of date not null,
  pillars_covered text[] not null,
  topics_covered text[] not null,
  top_theme text,
  created_at timestamp default now()
);

create table if not exists published_posts (
  id uuid default gen_random_uuid() primary key,
  week_of date not null,
  post_number integer,
  platform text,
  post_type text,
  pillar text,
  caption_preview text,
  scheduled_time timestamp,
  created_at timestamp default now()
);

create table if not exists echo_scores (
  id uuid default gen_random_uuid() primary key,
  week_of date not null,
  email_signups integer default 0,
  chatbot_opens integer default 0,
  instagram_saves integer default 0,
  link_clicks integer default 0,
  best_pillar text,
  biggest_lever text,
  created_at timestamp default now()
);
