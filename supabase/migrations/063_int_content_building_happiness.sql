-- ============================================================
-- 063_int_content_building_happiness.sql — Building Happiness session content (Phase 2)
--
-- Session Zero + 14 sessions for prog_int_happiness, authored faithfully from the spec (doc 03 / PDF
-- §"BUILDING HAPPINESS"). PERMA spine; the strongest evidence base of the three (PPIs, 14-session
-- Positive Psychotherapy). Its differentiator is person-activity fit — Riley runs each practice as an
-- experiment and keeps what works for THIS person (the "fit ledger", tracked at runtime via
-- confirmations). Framing rule: happiness is built, not found; "fine" is a legitimate starting pin, not
-- a diagnosis. Safety: toxic-positivity guardrail (validate before practicing, never reframe real
-- problems as attitude); Session Zero routes acute grief → Living Forward and crisis → crisis care.
-- Milestones 4/8/14. Requires 060. Run AFTER 060.
-- ============================================================

INSERT INTO int_sessions (program_key, session_number, phase, title, is_milestone, open_template, learn_body, work_spec, commit_options) VALUES

('prog_int_happiness', 0, 'INTAKE', $t$Session Zero — More Than Fine$t$, false,
 $t$Riley confirms what it knows (persona, prior programs, chat themes) and routes honestly: if there's acute grief or active crisis, it says so warmly — "This program will still be here. Right now I think we start somewhere else, together." Building Happiness is for stable-and-flat, not raw.$t$,
 $t$Happiness is built, not found — practiced, not felt into existence. "Fine" is a legitimate starting pin, not a diagnosis, and you are not broken for wanting more than it. The promise: we're going to run experiments. Some will work for you and some won't — that's not failure, that's the method. My job is to remember which is which.$t$,
 $j${"artifact":"My Starting Picture","intro":"A conversational intake — no survey, just Riley's five questions and your real answers.","prompts":["The flatness map: when did 'fine' start? What did alive last feel like, and what were you doing?","PERMA baseline, in Riley's voice: what reliably makes you feel good, even small? / what makes time disappear? / who do you feel most yourself around? / what feels like it matters? / what have you finished lately that you were proud of?","The joy inventory: what used to work — hobbies, people, music, places — even decades ago","Strengths, informally: what do people come to you for? What do you do easily that others find hard?","Constraints and seasons: work, caregiving, money, health — the program fits life as it is"]}$j$::jsonb,
 $j$["Your contract: your definition of 'more than fine' in your own words, a twice-a-week rhythm, and how you want Riley to reach you."]$j$::jsonb),

('prog_int_happiness', 1, 'BASELINE & FIRST WINS', $t$How Happiness Actually Works$t$, false,
 $t$Riley opens by naming where you're already strong — always first — before anything about where the room is.$t$,
 $t$The architecture: a set-point, your circumstances, and intentional activity. The only lever you truly own is the third — and it's a big one. The hedonic treadmill is why the new car stopped working. Happiness is a practice, not a personality you were or weren't born with.$t$,
 $j${"artifact":"My PERMA Picture v1","intro":"Walk through your PERMA picture from intake, together.","prompts":["Where you're already strong (named first, always)","Where there's room to build","This is a picture, not a grade"]}$j$::jsonb,
 $j$["Nothing yet except showing up for Session 2 — we start the practice there."]$j$::jsonb),

('prog_int_happiness', 2, 'BASELINE & FIRST WINS', $t$Three Good Things$t$, false,
 $t$Riley opens warm and ready to do the first practice with you, live.$t$,
 $t$The flagship gratitude practice — significant wellbeing effects across dozens of RCTs. It works because it retrains attention, which is the actual machinery of mood: the brain finds what it's told to hunt. The anti-cheese clause: specificity is the active ingredient — "the coffee was hot when I finally sat down" beats "my family."$t$,
 $j${"artifact":"Three Good Things (daily)","intro":"Do tonight's three with Riley now, coached toward specific.","prompts":["Name three good things from today","Push each toward the specific, sensory detail","This becomes your daily spine — one tap in the check-in"]}$j$::jsonb,
 $j$["Three good things nightly for the next 7 days. Riley starts tracking whether this one lands for you."]$j$::jsonb),

('prog_int_happiness', 3, 'BASELINE & FIRST WINS', $t$Savoring$t$, false,
 $t$Riley opens on the three-good-things week — and, honestly, whether it's landing or feeling like a chore.$t$,
 $t$Gratitude's cousin: staying inside a good moment instead of sprinting through it. There are three tenses — anticipating, being-in, remembering — and small techniques: slow down, name it, share it, memorize one detail.$t$,
 $j${"artifact":"My Savoring List","intro":"Pick tomorrow's savoring target from your actual day.","prompts":["The first coffee, the dog's greeting, the drive with the music","Choose targets that already exist in your day","Keep the list — these are your personal targets"]}$j$::jsonb,
 $j$["One savored moment daily for 5 days, reported in one line at check-in."]$j$::jsonb),

('prog_int_happiness', 4, 'ENGAGEMENT & STRENGTHS', $t$Your Strengths, Named$t$, true,
 $t$MILESTONE. Riley shows the fit data so far, honestly: "Three Good Things is landing; savoring felt forced — noted, we'll lean gratitude."$t$,
 $t$Signature strengths: using what you're built with beats fixing what you lack. The evidence for strengths-use on wellbeing and engagement is strong — and it's more sustainable than white-knuckling your weaknesses.$t$,
 $j${"artifact":"My Strengths Card","intro":"Name your top strengths together, and see where they already show up.","prompts":["From your intake (and the optional VIA survey, if you did it), name your top 3-5","For each, where it's already showing up in your life","The optional formal VIA survey is there if you want it"]}$j$::jsonb,
 $j$["Use ONE signature strength in ONE NEW WAY this week — Riley drafts three options fitted to your actual week."]$j$::jsonb),

('prog_int_happiness', 5, 'ENGAGEMENT & STRENGTHS', $t$Flow: Where Time Disappears$t$, false,
 $t$Riley opens on how the strength-in-a-new-way experiment ran.$t$,
 $t$Engagement is the E in PERMA — absorption, not pleasure. Flow needs a clear goal, a right-sized challenge, and immediate feedback. And phones murder it: every notification is an exit from the state.$t$,
 $j${"artifact":"My Flow Channels","intro":"Mine your joy inventory and your 'what made time disappear' answers.","prompts":["Identify your two likeliest flow channels — old or new","What conditions each one needs","Pick the one to protect this week"]}$j$::jsonb,
 $j$["One protected 30-minute flow block this week — scheduled, phone elsewhere, treated as an appointment."]$j$::jsonb),

('prog_int_happiness', 6, 'ENGAGEMENT & STRENGTHS', $t$The Attention Diet$t$, false,
 $t$Riley opens on the flow block — what it was like to be that absorbed again.$t$,
 $t$Subtraction as intervention: mood follows attention, and attention is being strip-mined. This isn't a digital-detox sermon — it's a trade. Thirty reclaimed minutes fund the flow block and the savoring.$t$,
 $j${"artifact":"My Counter-Move","intro":"Identify your single worst attention leak and design its specific counter-move.","prompts":["Name the one worst leak","Design the counter-move: app off the home screen, phone across the room at a named hour, one notification purge","Keep it to one change"]}$j$::jsonb,
 $j$["Run the counter-move for 5 days, and report what the reclaimed minutes became."]$j$::jsonb),

('prog_int_happiness', 7, 'ENGAGEMENT & STRENGTHS', $t$Movement & Light (The Body Vote)$t$, false,
 $t$Riley opens on the reclaimed minutes — and connects to your body's role without a sales pitch.$t$,
 $t$The boring giants: movement, daylight, and sleep move mood more than most psychology does. If you're in Move Nourish, Riley connects rather than re-teaches; if not, here's the minimum viable dose — eight minutes and morning light, no upsell.$t$,
 $j${"artifact":"The Body Vote","intro":"Place one small movement and a dose of morning light into your real week.","prompts":["One 8-minute movement","Two minutes of morning light","Into real days, at real times"]}$j$::jsonb,
 $j$["Movement + morning light ×4 this week, tracked in the daily tap."]$j$::jsonb),

('prog_int_happiness', 8, 'RELATIONSHIPS & KINDNESS', $t$Other People Are the Answer$t$, true,
 $t$MILESTONE. Riley updates the fit ledger with you — what's proven to land, what to retire.$t$,
 $t$The least surprising, most avoided finding in the field: relationships are the strongest single correlate of wellbeing. Social investment is a practice, not a personality trait. And the "liking gap" is real — people like you more than you think. The research says so.$t$,
 $j${"artifact":"Relationship Inventory","intro":"Map your relationships honestly.","prompts":["The energizers, the neutrals, the drains","Who've you under-invested in","Who's worth a deliberate reach"]}$j$::jsonb,
 $j$["One deliberate reach-out to an energizer this week — real plans, not a like."]$j$::jsonb),

('prog_int_happiness', 9, 'RELATIONSHIPS & KINDNESS', $t$Active-Constructive Responding$t$, false,
 $t$Riley opens on how the reach-out went.$t$,
 $t$The single highest-leverage relationship skill: how you respond to someone's GOOD news matters more than how you support their bad news. There are four response styles — enthusiasm-with-questions builds bonds, while "that's nice" quietly erodes them.$t$,
 $j${"artifact":"Held privately","intro":"Rehearse it with Riley until it feels natural.","prompts":["Riley plays a friend sharing good news","You practice active-constructive responding — real interest, real questions","Repeat until it stops feeling like a script"]}$j$::jsonb,
 $j$["Deploy active-constructive responding twice this week at real good-news moments; report what happened to the conversation."]$j$::jsonb),

('prog_int_happiness', 10, 'RELATIONSHIPS & KINDNESS', $t$Acts of Kindness$t$, false,
 $t$Riley opens on what active-constructive responding did to a real conversation.$t$,
 $t$Kindness reliably lifts the giver's wellbeing — with a dosing quirk from the research: several acts in ONE day beats the same acts scattered across a week (the "kindness day" effect). Variety matters. And kindness toward yourself counts — self-compassion is not indulgence.$t$,
 $j${"artifact":"My Kindness Day","intro":"Design your Kindness Day — five small acts, mixed targets, fitted to a real Saturday.","prompts":["A stranger","A friend","A past-due thank-you","Yourself"]}$j$::jsonb,
 $j$["Run the Kindness Day, and debrief at the next check-in."]$j$::jsonb),

('prog_int_happiness', 11, 'RELATIONSHIPS & KINDNESS', $t$The Gratitude Letter$t$, false,
 $t$Riley opens gently — this one is the heavyweight, and it can bring grief with it.$t$,
 $t$The gratitude letter produces some of the largest single-intervention effects ever measured in the field — with the honest caveat that they fade without practice, which is why it lives inside a program, not alone.$t$,
 $j${"artifact":"The Letter","intro":"Write it with Riley's help — to someone who shaped you and was never properly thanked.","prompts":["Who shaped you and never got the thanks","Write it fully, specifically","Delivery menu: read it to them (biggest effect), send it, or — if they're gone — read it aloud anyway. If grief arrives mid-exercise, that's normal and welcome; this door connects to Living Forward's Letter Forward."]}$j$::jsonb,
 $j$["Deliver the letter, by your chosen route."]$j$::jsonb),

('prog_int_happiness', 12, 'MEANING & MOMENTUM', $t$Best Possible Self$t$, false,
 $t$Riley opens on how it felt to deliver the letter.$t$,
 $t$The future-writing intervention: imagining yourself at your realistic best, after things went as well as they plausibly could. It has meta-analytic effects on wellbeing and optimism — and it works by clarifying what you actually want, which quietly reorganizes your choices.$t$,
 $j${"artifact":"Best Possible Self v1","intro":"A guided write — 12 minutes, Riley prompting, never authoring.","prompts":["Personal: your life, your health, your days","Relational: the people and the bonds","Work/craft: what you make and do","Write toward realistic-best, not fantasy"]}$j$::jsonb,
 $j$["Re-read it twice this week — once before a real decision."]$j$::jsonb),

('prog_int_happiness', 13, 'MEANING & MOMENTUM', $t$Meaning: The Through-Line$t$, false,
 $t$Riley opens holding everything you've written so far — and starts to see a pattern.$t$,
 $t$Meaning is the M that outlasts mood — belonging to and serving something beyond yourself. A happy day and a life that feels worth it both matter, and they're built differently. Meaning usually hides in existing roles — the job, the kids, the recovery, the garden — more often than in dramatic pivots.$t$,
 $j${"artifact":"My Through-Line","intro":"Find the theme that keeps recurring.","prompts":["Across your intake, your strengths, your letter, your best-possible-self, Riley reflects the repeated theme: 'everything you've written keeps circling back to ___ — do you see it too?'","You name your through-line in one sentence"]}$j$::jsonb,
 $j$["One act this week in explicit service of the through-line."]$j$::jsonb),

('prog_int_happiness', 14, 'MEANING & MOMENTUM', $t$The Happiness Practice$t$, true,
 $t$MILESTONE / GRADUATION. Riley lays your PERMA Picture v1 against now, and reads the fit ledger back: "here's what works FOR YOU, proven by seven weeks of your own data."$t$,
 $t$Maintenance honesty: the effects fade when the practice stops. The Practice you're about to build is a floor, not a phase — and it's yours because you tested it, not because a book said so.$t$,
 $j${"artifact":"The Happiness Practice + PERMA Picture v2 + the Statement","intro":"Build your personal keeper set — proven, not prescribed.","prompts":["Typically: the daily three-good-things tap, one savoring target, the flow block, one relationship investment a week, the Kindness Day quarterly, the Best Possible Self rewrite yearly","Keep only what your fit ledger proved","Becoming Statement, happiness edition: 'I'm becoming someone whose ordinary days include ___.'"]}$j$::jsonb,
 $j$["Adopt your Happiness Practice as your floor. Riley references it in normal chat, and offers a quarterly PERMA re-picture if you want it."]$j$::jsonb)

ON CONFLICT (program_key, session_number) DO UPDATE SET
  phase=EXCLUDED.phase, title=EXCLUDED.title, is_milestone=EXCLUDED.is_milestone,
  open_template=EXCLUDED.open_template, learn_body=EXCLUDED.learn_body,
  work_spec=EXCLUDED.work_spec, commit_options=EXCLUDED.commit_options, updated_at=now();
