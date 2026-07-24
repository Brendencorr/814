# RILEY - EXPERIENCE ROADMAP (approved by Brenden 2026-07-24)
Source: product-experience review triage handoff. Brand laws throughout: hyphens only, no
urgency, no streak shame, Sentinel lexicon, crisis suppression on everything, missed days
met with welcome.

## SEQUENCE
- NOW (pre-8/1): North Star law (CLAUDE.md) + Porch Lights LEVEL 1 ONLY (view-only).
- NEXT (weeks 1-4 post-launch): check-in funnel + Daily Three; Clarity subdimensions (dark-run).
- THEN (~30 days in, with member data): pattern engine v1; subdimensions reveal.
- LATER (Doc 06/Mentor, founder-gated): Porch Levels 2-5, pattern engine in briefs, Connection deepening.
- DEFERRED (do not build): "What works for me" library; named Clarity states.

## 1 PORCH LIGHTS - participation ladder (vision map; LEVEL 1 is the whole current scope)
L1 See the lights (ambient counts, view-only - SHIPPED) · L2 Sit on the porch (anonymous join) ·
L3 Leave a light on (one moderated sentence) · L4 Circles · L5 Sessions.
Level 1 card (Level-2 dashboard area, never above Clarity/next-step):
"The porch tonight / N porch lights are on tonight. X people are sitting with grief. ... /
You don't have to say anything to be here." (closing line NEVER omitted)
Build: presence_heartbeat (authed ping, throttle 1/10min) -> porch_presence(user_id, lane,
seen_at); aggregation returns rolling-24h total + per-lane counts ONLY - the API cannot return
a member id. PRIVACY LAWS: per-lane min-count 12 (below -> lane-less fallback "The porch light
is on tonight. You're not the only one here."; total<12 -> "The porch light is on tonight.");
opt-out toggle "Count me on the porch" (Account, default on); crisis mode keeps the card,
drops lane labels. Levels 2-5: nothing may presuppose them (no dormant buttons, no post schema).

## 2 PATTERN ENGINE "What Riley is noticing" (THEN)
Classes: Observed / Emerging / Contextual. Every insight = 5 parts: observation · plain-language
confidence (never percentages) · why it matters · one next step · member controls.
Controls (honored ABSOLUTELY): That's right / That's not it (re-weight) · Don't show me this one
again (permanent) · Stop noticing this (kills signal class). Feedback -> insight_feedback; a
dismissed pattern never returns reworded. Surfacing: max 1/day; never in crisis, lapse-repair,
provisional Clarity, or on hard dates; brief/dashboard only, no notifications v1; utility model
+ Never-Say gate + static-silence fallback. Inputs v1: check-ins, sleep/movement/nutrition,
habits, mood, day-of-week; conversation themes only as coarse stored tags - never quotes.

## 3 ADAPTIVE CHECK-IN FUNNEL + DAILY THREE (NEXT)
Opening: "How are you arriving today?" -> exactly ONE tailored follow-up:
heavy "Missing someone, feeling alone, disappointed - or something else?" · anxious "More in
your head, in your body, about something specific - or hard to say?" · flat "Running on empty,
or just quiet today?" · good "What feels different today?" · hard-to-say = complete answer,
no third question ever. Same-day shaping: brief tone/length, dashboard density, Daily Three
intensity, journal prompts, notifications (heavy -> nudges off, presence on).
DAILY THREE: ceiling of three, capacity-matched (FOR YOUR MIND / BODY / LIFE). Controls per
item: swap · Make it smaller · schedule · complete · This doesn't fit (+why). Fallbacks always
smaller, never sterner. Completion language = kept promises ("One promise kept." "You protected
the basics." "You came back."), never streaks. Crisis/lapse -> stabilization pack instead.

## 4 CLARITY SUBDIMENSIONS - MIND/BODY/MOMENTUM/CONNECTION (NEXT, display-gated)
Interpretive rollups under the score - state words, NEVER four more numbers (one-number law).
MIND mood/check-ins/journal · BODY sleep/movement/nutrition · MOMENTUM habits/programs/returns ·
CONNECTION reach-outs, People-Who-Matter mentions, porch presence (L2 later), community later.
Vocabulary (fixed): steady · growing · stretched · resting · still learning (null; Connection
launches in it). Never depleted-as-red/failing/behind; Signal Red never appears. Five stat
tiles REMAIN. Hidden during provisional Clarity, RE-LIGHT window, lapse-repair.
FOUNDER DECISIONS PENDING before member-visible: (1) Connection v1 sources; (2) the five state
words; (3) visible at launch vs two-week dark-run (recommendation: dark-run, then reveal - no
announcement, per the no-migration-message decision).
