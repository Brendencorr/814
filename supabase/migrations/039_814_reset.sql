-- ============================================================
-- 039_814_reset.sql
-- The 8:14 Project — THE 8:14 RESET (v1.1)
--
-- Rebuilds the free onboarding program (formerly the "7-Day Reset") as a
-- Morning Action + Evening Close program: 14 moments across 7 days. Universal
-- curriculum, personal voice. The internal program slug stays '7-day-reset'
-- so existing journey_steps rows, entitlements, and links keep working — only
-- the DISPLAY name changes, in the app + this new content model.
--
-- Safe to re-run. Run AFTER 038.
-- ============================================================

-- ── Content: the universal 7-day curriculum (morning action + evening close) ──
CREATE TABLE IF NOT EXISTS reset_days (
  day_number         int PRIMARY KEY,
  theme              text NOT NULL,
  theme_line         text,
  morning_checkin    text NOT NULL,
  action_title       text DEFAULT 'The One Thing',
  action_body        text NOT NULL,
  action_why         text,
  evening_reflection text NOT NULL,
  fuel_setup         text,
  est_seconds        int NOT NULL DEFAULT 494,   -- 8:14
  created_at         timestamptz DEFAULT now()
);
ALTER TABLE reset_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reset_days readable" ON reset_days;
CREATE POLICY "reset_days readable" ON reset_days FOR SELECT USING (true);

-- ── Riley's persona voice per day/segment (the §8 matrix, as data not code) ──
CREATE TABLE IF NOT EXISTS reset_day_variants (
  id          bigserial PRIMARY KEY,
  day_number  int  NOT NULL REFERENCES reset_days(day_number) ON DELETE CASCADE,
  persona_key text NOT NULL,   -- griever | drinker | burnt_out | stretched | body_first
  segment     text NOT NULL DEFAULT 'action',
  text        text NOT NULL,
  UNIQUE (day_number, persona_key, segment)
);
ALTER TABLE reset_day_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reset_variants readable" ON reset_day_variants;
CREATE POLICY "reset_variants readable" ON reset_day_variants FOR SELECT USING (true);

-- ── Per-user enrollment: Day-1 persona + their own words (quoted back Day 7) ──
CREATE TABLE IF NOT EXISTS reset_enrollment (
  user_id       uuid PRIMARY KEY,
  persona_keys  text[],          -- whole-person: may be several
  day1_sentence text,            -- their Day-1 answer, verbatim, for the Day-7 callback
  started_at    timestamptz DEFAULT now()
);
ALTER TABLE reset_enrollment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own reset enrollment" ON reset_enrollment;
CREATE POLICY "own reset enrollment" ON reset_enrollment FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Two-touch progress (the ACTION completes a day; the evening close is bonus) ──
CREATE TABLE IF NOT EXISTS reset_progress (
  user_id         uuid NOT NULL,
  day_number      int  NOT NULL,
  morning_done_at timestamptz,
  evening_done_at timestamptz,
  updated_at      timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, day_number)
);
ALTER TABLE reset_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own reset progress" ON reset_progress;
CREATE POLICY "own reset progress" ON reset_progress FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Program-scoped notification consent (canonical pattern, §3) ──
-- Consent attaches to ONE program with an automatic end date. Someone can want
-- nudges for the Reset and none ever again — honored automatically via ends_at.
CREATE TABLE IF NOT EXISTS notification_consents (
  user_id           uuid NOT NULL,
  program_key       text NOT NULL,           -- '7-day-reset'
  granted           boolean NOT NULL DEFAULT false,
  starts_at         timestamptz,
  ends_at           timestamptz,             -- Reset = 7 program days + 3 grace, then hard stop
  cadence           text DEFAULT 'am_pm',
  quiet_start       text DEFAULT '21:30',    -- local; no sends 9:30pm–7:30am unless changed
  quiet_end         text DEFAULT '07:30',
  channel           text DEFAULT 'email',    -- 'email' (v1) | 'push'
  push_subscription jsonb,                    -- web-push subscription, if channel='push'
  tz                text DEFAULT 'America/Denver',
  status            text DEFAULT 'active',    -- active | ended | revoked
  updated_at        timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, program_key)
);
ALTER TABLE notification_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own notif consent" ON notification_consents;
CREATE POLICY "own notif consent" ON notification_consents FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SEED — the seven days (§7)
-- ============================================================
INSERT INTO reset_days (day_number, theme, theme_line, morning_checkin, action_body, action_why, evening_reflection, fuel_setup) VALUES
(1, $$Show Up$$, $$You don't have to know what's wrong to start.$$,
 $$Before we do anything — what's the heaviest thing you're carrying right now? One sentence. You don't have to organize it. Just name it.$$,
 $$Write it down on paper — the thing you just told me, in your own handwriting. Then: ten slow breaths (four in, six out), one full glass of water. That's the whole assignment.$$,
 $$Naming a thing takes weight off it, the breath and water give the body one calm minute, and finishing day one in minutes proves this is survivable.$$,
 $$What made you start this today — and not last month?$$,
 $$Put a glass of water by the bed for the morning.$$),
(2, $$Move$$, $$The body keeps score, so the body gets a vote.$$,
 $$When's the last time your body felt good — even for a minute? What were you doing?$$,
 $$A six-minute walk. Outside if you can; pacing a hallway counts. Not exercise — movement. If walking isn't available, six minutes of seated stretching.$$,
 $$Movement is the most reliable first activation there is — it lifts mood in the moment and interrupts the loop.$$,
 $$Where did you walk, and what did you notice?$$,
 $$Decide tonight what protein is at breakfast tomorrow — eggs, yogurt, leftovers, anything.$$),
(3, $$Eat$$, $$Energy changes everything.$$,
 $$What time of day do you crash — and what do you usually reach for when it happens?$$,
 $$Plan and eat (or prep) one real meal today — the 8:14 Starter Plate: a protein, a vegetable, and something whole. Assembly counts. Rotisserie chicken + bagged salad + microwave rice is a triumph.$$,
 $$Decision fatigue, not knowledge, is why people don't eat well when life is heavy. We take the decision away.$$,
 $$What did you eat, and how did you feel an hour after?$$,
 $$The Two-Item Rule: add one protein you like and one vegetable you'll actually eat to your next store run.$$),
(4, $$Clear$$, $$The 3 a.m. loop is not the truth. It's just loud.$$,
 $$What loops in your head when it's quiet? The thing that shows up at night, or on the drive.$$,
 $$The Worry Dump. Set a timer for five minutes and write everything looping — no order, no grammar, nobody sees it. When the timer ends, close it. It's on the page now; it doesn't have to ride around in your head all day.$$,
 $$Writing it out and giving worry a set time measurably quiets the loop — the same engine under grief, anxiety, and craving.$$,
 $$Read back one thing you wrote this morning. Is it a fact, or a fear?$$,
 $$Pick which one drink tomorrow becomes water — one soda, one energy drink, one beer, one anything.$$),
(5, $$Connect$$, $$Heaviness isolates. Isolation makes it heavier. Break the loop once.$$,
 $$Who haven't you answered lately — not because you don't care, but because you didn't have it in you?$$,
 $$Send one text. One person, one honest message — I'll draft a few options in your voice if you want, from minimal to real. Sending is the win. A reply is not required.$$,
 $$Reaching out is the highest-value, most-avoided action there is — one text is its smallest real dose.$$,
 $$How did it feel to hit send? And if they replied — no pressure — what did they say?$$,
 $$Pick tomorrow's one screen-free eating moment. Three minutes of just eating counts.$$),
(6, $$Rest$$, $$You can't rebuild on empty. Tonight, we protect the recharge.$$,
 $$What does your last hour before sleep actually look like? Be honest — no grades here.$$,
 $$The 8:14 Wind-Down, chosen this morning and done tonight: (1) pick a caffeine cutoff time for today, (2) tonight, phone plugged in across the room — or face-down, out of reach, (3) make one small square of your world orderly: the bed, the sink, one surface.$$,
 $$Sleep is the multiplier on every other day, and designing the environment beats spending willpower.$$,
 $$What's the one thing you made orderly — how does it look?$$,
 $$Nothing new tonight — the wind-down is tonight's fuel move.$$),
(7, $$Direction$$, $$This was never about seven days.$$,
 $$Seven days ago you named the heaviest thing you were carrying. Read that again. What's true about it today?$$,
 $$The Becoming Statement. One line — "I'm becoming someone who ______" — built from your own week: you walked, ate a real meal, texted someone, put the loop on paper. Write it down. Keep it where you'll see it.$$,
 $$Identity is what makes a habit stick — and it's the whole mission: become who you were meant to become.$$,
 $$Today I want to tell you one honest thing about what might help next — no pressure, and the Guide stays free either way.$$,
 $$Decide tonight what tomorrow's breakfast is. Day 8 exists. That's the point.$$)
ON CONFLICT (day_number) DO UPDATE SET
  theme=EXCLUDED.theme, theme_line=EXCLUDED.theme_line, morning_checkin=EXCLUDED.morning_checkin,
  action_body=EXCLUDED.action_body, action_why=EXCLUDED.action_why,
  evening_reflection=EXCLUDED.evening_reflection, fuel_setup=EXCLUDED.fuel_setup;

-- ============================================================
-- SEED — the persona voice matrix (§8): same action, different voice
-- ============================================================
INSERT INTO reset_day_variants (day_number, persona_key, segment, text) VALUES
-- Day 2 · Move
(2, $$griever$$,    $$action$$, $$Grief lives in the body too. Walk with it, not away from it.$$),
(2, $$drinker$$,    $$action$$, $$A walk is the original craving interrupt. Six minutes buys you six minutes.$$),
(2, $$burnt_out$$,  $$action$$, $$Not a workout. Just proof you still have legs that go places meetings can't.$$),
(2, $$stretched$$,  $$action$$, $$Six minutes that belong to no one but you.$$),
(2, $$body_first$$, $$action$$, $$We're not fixing your body. We're just reminding it you're on the same team.$$),
-- Day 3 · Eat
(3, $$griever$$,    $$action$$, $$Grief kills appetite or turns it inside out. One real meal is an act of staying.$$),
(3, $$drinker$$,    $$action$$, $$Early recovery blood sugar is a rollercoaster that impersonates cravings. Food is defense.$$),
(3, $$burnt_out$$,  $$action$$, $$You've been running on caffeine and adrenaline. One real meal is a ceasefire.$$),
(3, $$stretched$$,  $$action$$, $$You feed everyone. Today, someone feeds you — even if it's you.$$),
(3, $$body_first$$, $$action$$, $$One good plate. Not a diet. A down payment.$$),
-- Day 4 · Clear
(4, $$griever$$,    $$action$$, $$The loop about them — the last day, the things unsaid. Put it on paper where it can rest.$$),
(4, $$drinker$$,    $$action$$, $$The 3 a.m. bargaining committee. Get its minutes on paper.$$),
(4, $$burnt_out$$,  $$action$$, $$The Sunday-night dread, on paper, where it's smaller than it sounds in your head.$$),
(4, $$stretched$$,  $$action$$, $$All the things you're holding for everyone. Five minutes: set them down.$$),
(4, $$body_first$$, $$action$$, $$The mirror voice. Write down what it says — then ask whether it'd say that to anyone else.$$),
-- Day 4 · Fuel (the drink-swap) — honest, zero-pressure framing for the Drinker
(4, $$drinker$$,    $$fuel$$,   $$You know which drink I mean. Just one, just tomorrow, water instead. No lecture. If tomorrow's not the day, the walk still counts.$$),
-- Day 5 · Connect
(5, $$griever$$,    $$action$$, $$The person you most want to text may be the one you lost. Text someone who loved them too.$$),
(5, $$drinker$$,    $$action$$, $$Isolation is the disease's favorite room. One text opens a window.$$),
(5, $$burnt_out$$,  $$action$$, $$One colleague-free human. Someone who knew you before the job did.$$),
(5, $$stretched$$,  $$action$$, $$Not a family member. Someone who asks about YOU.$$),
(5, $$body_first$$, $$action$$, $$Someone who never once commented on your weight.$$)
ON CONFLICT (day_number, persona_key, segment) DO UPDATE SET text=EXCLUDED.text;

-- ── Rename the program itself: the app reads the display title/tagline from `programs` ──
UPDATE programs SET
  title = 'The 8:14 Reset',
  tagline = 'Seven days. 8:14 a day.',
  completion_message = 'Seven days. Fourteen moments. You showed up for yourself, one small thing at a time — that is the whole thing. Whatever you carry forward, carry it gently. I''m right here.'
WHERE slug = '7-day-reset';

-- ── Interim: re-seed the existing journey_steps so the renamed program shows the
--    NEW 8:14 Reset content through today's journey.html right away. (The full
--    Morning/Evening two-touch experience reads reset_days and supersedes this.) ──
INSERT INTO journey_steps (program_slug, day_number, title, lesson, action, journal_prompt, riley_message, recommended_content_types, completion_trigger) VALUES
('7-day-reset', 1, $$Show Up$$,
 $$You don't have to know what's wrong to start. Naming a thing takes weight off it — and finishing day one in minutes proves this is survivable.$$,
 $$Write down the heaviest thing you're carrying — in your own handwriting. Then ten slow breaths (four in, six out) and one full glass of water.$$,
 $$What made you start this today — and not last month?$$,
 $$You showed up. That's the whole assignment today, and you already did it. I'm glad you're here.$$,
 ARRAY['breathwork','journal_prompt'], 'manual'),
('7-day-reset', 2, $$Move$$,
 $$The body keeps score, so the body gets a vote. Movement is the most reliable way to lift mood in the moment and interrupt the loop.$$,
 $$A six-minute walk. Outside if you can; pacing a hallway counts. Not exercise — movement. Can't walk? Six minutes of seated stretching.$$,
 $$Where did you walk, and what did you notice?$$,
 $$Two days. Not a workout — just proof your body is still on your team. Tonight, decide tomorrow's breakfast protein.$$,
 ARRAY['walk','music'], 'manual'),
('7-day-reset', 3, $$Eat$$,
 $$Energy changes everything. Decision fatigue, not knowledge, is why eating well is hard when life is heavy — so we take the decision away.$$,
 $$Eat or prep one real meal — the 8:14 Starter Plate: a protein, a vegetable, and something whole. Assembly counts. Rotisserie chicken + bagged salad + rice is a triumph.$$,
 $$What did you eat, and how did you feel an hour after?$$,
 $$One good plate — not a diet, a down payment. Add one protein and one vegetable to your next store run.$$,
 ARRAY['recipe','journal_prompt'], 'manual'),
('7-day-reset', 4, $$Clear$$,
 $$The 3 a.m. loop is not the truth. It's just loud. Writing it out and giving worry a set time measurably quiets it.$$,
 $$The Worry Dump. Set a timer for five minutes and write everything looping — no order, no grammar, nobody sees it. When it ends, close it.$$,
 $$Read back one thing you wrote this morning. Is it a fact, or a fear?$$,
 $$It's on the page now. It doesn't have to ride around in your head all day.$$,
 ARRAY['breathwork','journal_prompt'], 'manual'),
('7-day-reset', 5, $$Connect$$,
 $$Heaviness isolates, and isolation makes it heavier. Reaching out is the highest-value, most-avoided thing there is — one text is its smallest dose.$$,
 $$Send one text. One person, one honest message. Sending is the win — a reply is not required.$$,
 $$How did it feel to hit send?$$,
 $$You don't have to carry any of this alone — and you were never meant to.$$,
 ARRAY['community_prompt','journal_prompt'], 'manual'),
('7-day-reset', 6, $$Rest$$,
 $$You can't rebuild on empty. Sleep is the multiplier on every other day, and designing your environment beats spending willpower.$$,
 $$The 8:14 Wind-Down: pick a caffeine cutoff for today; tonight, phone across the room; make one small square of your world orderly — the bed, the sink, one surface.$$,
 $$What's the one thing you made orderly — how does it look?$$,
 $$Almost a full week. Tonight, protect the recharge. You've earned the rest.$$,
 ARRAY['breathwork','music'], 'manual'),
('7-day-reset', 7, $$Direction$$,
 $$This was never about seven days. Identity is what makes a habit stick — and it's the whole mission: become who you were meant to become.$$,
 $$Write your Becoming Statement: "I'm becoming someone who ______" — built from your week. You walked, ate a real meal, texted someone, put the loop on paper. Keep it where you'll see it.$$,
 $$What are you carrying forward?$$,
 $$Seven days. Fourteen moments. You showed up for yourself — that's everything. Day 8 exists; that's the point. I'm right here.$$,
 ARRAY['celebration','journal_prompt'], 'manual')
ON CONFLICT (program_slug, day_number) DO UPDATE SET
  title=EXCLUDED.title, lesson=EXCLUDED.lesson, action=EXCLUDED.action,
  journal_prompt=EXCLUDED.journal_prompt, riley_message=EXCLUDED.riley_message,
  recommended_content_types=EXCLUDED.recommended_content_types;
