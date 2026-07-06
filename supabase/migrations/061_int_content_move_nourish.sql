-- ============================================================
-- 061_int_content_move_nourish.sql — Move Nourish session content (Phase 2)
--
-- Session Zero + 14 sessions for prog_int_move_nourish, authored faithfully from the interactive
-- program spec (doc 01 / PDF §"MOVE NOURISH"). This is the session SPEC, not a script: Riley delivers
-- it conversationally at runtime (OPEN from memory → LEARN → WORK → COMMIT), pulling the member's own
-- history. work_spec = the exercise (artifact + prompts); commit_options = Riley-drafted commitments
-- the member picks from or edits. Milestones at 4/8/11/14. Idempotent (ON CONFLICT by program+number).
--
-- Safety spine (spec §6), enforced by content here + crisis architecture at runtime: coach-not-clinician
-- stated in Session Zero; medical screener in Session Zero; NO calories/weights/before-afters anywhere;
-- disordered-eating signals shift the Nourish phase off quantity entirely; crisis suspends the program.
-- Requires 060. Run AFTER 060.
-- ============================================================

INSERT INTO int_sessions (program_key, session_number, phase, title, is_milestone, open_template, learn_body, work_spec, commit_options) VALUES

('prog_int_move_nourish', 0, 'INTAKE', $t$Session Zero — The Real Answers$t$, false,
 $t$Riley opens by confirming what it already knows (Reset baseline, persona, any Body Rebuild answers) and asking what it has wrong — never re-asking a settled fact. Then, plainly: "I'm about to build a plan around your actual life, not a template. So I need the real answers, including the unflattering ones. Especially those."$t$,
 $t$This is a coaching partnership, not clinical care — Riley says so here, in plain language. The more honest this intake is, the more the plan is actually yours. Every answer is remembered and reused across Riley, tagged to this program; nothing here gets asked twice.$t$,
 $j${"artifact":"Session Zero Intake","intro":"The deep intake — Riley asks, you talk, Riley builds the plan around what's real.","prompts":["Body history: injuries, pain, conditions, meds that affect energy or blood sugar; what exercise has felt like in the past (shame? punishment? freedom?); the last time movement was GOOD","The real schedule: actual wake/sleep times, work shape, caregiving loads, the honest windows where 15 minutes exists","Kitchen reality: who cooks, who else eats, budget band, equipment, the 3 meals you already make without thinking","Food story: eating patterns when stressed/sad/late; dieting history and how it ended (screening-lite — routes AWAY from numbers if disordered-eating signals appear)","The why beneath the why: 'If this worked completely, what would be different a year from now that you actually care about?' (kept verbatim — returns at Sessions 7 and 14)","Medical screener: conditions, meds, pregnancy, pain → conservative defaults and 'check with your doctor' gating where indicated"]}$j$::jsonb,
 $j$["Set your contract: your goal in your own words, a 2-sessions/week cadence, your nudge channels, and your 'floor' — the pre-agreed bad-week minimum that is a design input, not a failure."]$j$::jsonb),

('prog_int_move_nourish', 1, 'FOUNDATION', $t$Your Baseline, Your Terms$t$, false,
 $t$Riley opens warmly and, if this is the first session after the contract, restates the goal in the member's own words.$t$,
 $t$Capacity, not appearance. Energy is the first metric — and for month one, the only one. We are not measuring what you look like; we are measuring what your body can do and how it feels doing it.$t$,
 $j${"artifact":"Baseline v1","intro":"A four-question baseline done live with Riley — plus one guaranteed win.","prompts":["Stairs: how a flight feels today","Floor-rise: getting down and up","Sleep: how you're actually sleeping","3pm energy: the afternoon read","One movement Riley picks from your intake as a guaranteed-win first rep — done now, together"]}$j$::jsonb,
 $j$["One 10-minute movement window this week, placed together into your real calendar.","If the week turns hard: your floor — the smaller version you already agreed to."]$j$::jsonb),

('prog_int_move_nourish', 2, 'FOUNDATION', $t$The Plan We Build Together$t$, false,
 $t$Riley opens from memory: last session's 10-minute window — did it happen? Confirmed → celebrate the specific thing. Unconfirmed → curiosity, never disappointment: "tell me about the week instead; we'll find where it fits."$t$,
 $t$Self-Determination Theory in plain clothes: plans people choose stick; plans prescribed to them don't. Menus beat mandates. So we build from options, and you edit until it's yours.$t$,
 $j${"artifact":"Movement Plan v1","intro":"Riley presents 3 weekly-structure options built from your real windows; you pick and edit.","prompts":["Option A: Tu/Th/Sa mornings, 10 minutes","Option B: daily 8 minutes","Option C: 2×15, weekend-loaded","Swap, shrink, or rewrite any of it until the plan is genuinely yours"]}$j$::jsonb,
 $j$["Run the week as you designed it.","Floor version if the week breaks: keep one session, drop the rest, no guilt."]$j$::jsonb),

('prog_int_move_nourish', 3, 'FOUNDATION', $t$The Anchor & The Floor$t$, false,
 $t$Riley opens on the plan's first real week — names what fired and what didn't, without audit.$t$,
 $t$Habits anchor to events, not clock times. Attach movement to something you already do every day. And the floor is pre-decided on purpose: a bad week is a design input, not a failure state.$t$,
 $j${"artifact":"Plan v1.1 (anchor + floor)","intro":"Pick the anchor and write the floor into the plan.","prompts":["Choose your anchor: 'After I pour my morning coffee → the 8-Minute Reset'","Write your floor into the plan in your own words — the minimum that still counts on the worst week"]}$j$::jsonb,
 $j$["Run your anchored sessions this week, and tell me which anchor actually fired.","Just the anchor once, if that's what this week allows."]$j$::jsonb),

('prog_int_move_nourish', 4, 'MOVE', $t$Progressive Overload, Humanely$t$, true,
 $t$MILESTONE. Phase review: Riley reads Baseline v1 back and names the pattern of your first two weeks — the real one, missed sessions included.$t$,
 $t$The boredom rule: you progress when it's boring, not when it hurts. Here's how the A→B→C ladder works — and why holding steady is coaching too, not falling behind.$t$,
 $j${"artifact":"Movement Plan v1.2","intro":"Riley proposes this week's progression based on your confirmations so far — or holds, deliberately.","prompts":["Review what your confirmations say about readiness","Riley proposes the next rung — or a hold week if that's the honest call","You adjust the week to match"]}$j$::jsonb,
 $j$["Run the adjusted week.","Hold at the current level for one more week — a valid, chosen move."]$j$::jsonb),

('prog_int_move_nourish', 5, 'MOVE', $t$The Interrupt$t$, false,
 $t$Riley opens from memory on the adjusted week.$t$,
 $t$State-change science: movement is the fastest legal interrupt for a low mood, a craving, or a stress spike. The 8-Minute Reset is your tool — deployed at YOUR named trigger moments from intake and history.$t$,
 $j${"artifact":"My 8-Minute Reset","intro":"Personalize the Reset to your space and body, and rehearse it once, live.","prompts":["Fit the Reset to your actual space and body","Tie it to one named trigger moment from your intake","Rehearse it once now, together"]}$j$::jsonb,
 $j$["Deploy the 8-Minute Reset once this week at a real trigger moment, and tell me what it interrupted.","A 3-minute version if 8 won't fit the moment — smaller still counts."]$j$::jsonb),

('prog_int_move_nourish', 6, 'MOVE', $t$Strength Is Self-Respect$t$, false,
 $t$Riley opens on how the Interrupt went — what it caught.$t$,
 $t$Strength — not cardio volume — is the highest-yield investment for energy, sleep, blood sugar, and aging. And the words 'toned' and 'bulky' are banned here; we are building capacity, not appearance.$t$,
 $j${"artifact":"Movement Plan v2","intro":"Add the strength block, fitted to your equipment reality.","prompts":["Sit-to-stands → backpack squats → carries progression","Fit each move to the equipment you actually have","Slot two strength blocks into the plan"]}$j$::jsonb,
 $j$["Two strength blocks this week.","One strength block if two won't fit — the pattern matters more than the count."]$j$::jsonb),

('prog_int_move_nourish', 7, 'MOVE', $t$The Wall Week$t$, false,
 $t$Riley opens by reading your Session Zero 'why beneath the why' back to you — verbatim, in your own words.$t$,
 $t$Weeks 3–4 are where most plans die: the novelty is gone and the results aren't visible yet. This session is the program's most protective one, and it's delivered BEFORE the wall on purpose — so you meet it with a plan instead of a surprise.$t$,
 $j${"artifact":"The Wall Card","intro":"Write the one-screen card that gets you through the wall.","prompts":["Your why (from Session Zero)","Your floor","Your anchor","All on one screen, saved to your phone"]}$j$::jsonb,
 $j$["Run the week as planned, Wall Card saved to your phone.","Floor week if the wall hits hard — the card is for exactly this."]$j$::jsonb),

('prog_int_move_nourish', 8, 'NOURISH', $t$Blood Sugar Runs the Show$t$, true,
 $t$MILESTONE. Phase review: Riley celebrates your movement confirmations specifically — names the actual sessions you showed up for.$t$,
 $t$The spike–crash cycle. Your reported crash times map onto your reported eating — and protein anchoring is the lever. No calories, no weights; we're changing the shape of the day, not counting it.$t$,
 $j${"artifact":"My Breakfast Redesign","intro":"Redesign your real breakfast together, from what's already in your kitchen.","prompts":["Look at what's already in your kitchen","Anchor breakfast with protein","Keep it to things you'll actually make"]}$j$::jsonb,
 $j$["A protein-anchored breakfast ×4 this week; rate your 3pm each day with one tap.","×2 this week if 4 is too many — regularity beats perfection."]$j$::jsonb),

('prog_int_move_nourish', 9, 'NOURISH', $t$Your Kitchen, Systematized$t$, false,
 $t$Riley opens on the breakfast week and the 3pm ratings — what the pattern shows.$t$,
 $t$The enemy isn't lack of knowledge, it's decision fatigue. Batch-Once logic removes the daily decisions before they can wear you down.$t$,
 $j${"artifact":"My Shopping Template v1","intro":"Build your shopping template from the 5 Rebuild Foods + your no-think meals.","prompts":["The 5 Rebuild Foods","Your 3 no-think meals","Your household constraints (budget, who eats, equipment)"]}$j$::jsonb,
 $j$["Run one store trip from the template.","Order the template for pickup/delivery if a trip won't happen this week."]$j$::jsonb),

('prog_int_move_nourish', 10, 'NOURISH', $t$The Week of Eating, Assembled$t$, false,
 $t$Riley opens on how the store trip went — what made it into the kitchen.$t$,
 $t$The Starter Plate is the only rule, and assembly IS cooking — you don't have to be a chef, you have to be a person who assembles.$t$,
 $j${"artifact":"My Week of Eating v1","intro":"Riley drafts a 7-day pattern from the 28-meal library, filtered to you; you swap until it's yours.","prompts":["Filtered by your budget, equipment, household, and tastes","Swap any meal you won't actually eat","Keep only what's genuinely yours"]}$j$::jsonb,
 $j$["Schedule your batch hour into a real 60-minute block this week.","A 30-minute mini-batch if a full hour won't happen."]$j$::jsonb),

('prog_int_move_nourish', 11, 'NOURISH', $t$Eating When It's Not About Food$t$, true,
 $t$MILESTONE. Riley opens gently — this is the tender one.$t$,
 $t$Stress-eating, sad-eating, late-eating: a pattern, not a character flaw. There's a loop — trigger → relief → crash — and there's an interrupt: the same 8-Minute Reset, a protein bridge, or the 10-minute delay. Zero restriction, zero shame.$t$,
 $j${"artifact":"My Counter-Move","intro":"Map your #1 pattern moment and design its specific counter-move.","prompts":["Name the single moment the pattern shows up most","Choose the interrupt that fits it (Reset / protein bridge / 10-minute delay)","Design the counter-move for that exact moment"]}$j$::jsonb,
 $j$["Deploy the counter-move once this week, and report honestly either way — the honesty is the win.","Just notice and name the moment once, if deploying feels like too much this week."]$j$::jsonb),

('prog_int_move_nourish', 12, 'KEEP GOING', $t$Sleep Is the Multiplier$t$, false,
 $t$Riley opens on the counter-move — whatever happened, named without judgment.$t$,
 $t$Recovery is where the rebuild actually happens. Your reported sleep — from intake and your confirmations — reflected back, honestly.$t$,
 $j${"artifact":"My Wind-Down","intro":"Personalize your wind-down.","prompts":["Your caffeine line (the last acceptable hour)","Phone geography (where it charges at night)","Wake-time consistency"]}$j$::jsonb,
 $j$["Run your wind-down ×4 this week.","×2 if this is a hard week for sleep — even a partial wind-down counts."]$j$::jsonb),

('prog_int_move_nourish', 13, 'KEEP GOING', $t$The Bad Week Simulation$t$, false,
 $t$Riley opens by showing you your own confirmation record — including the missed ones — and what happened after: "you missed twice and came back twice. That's the skill."$t$,
 $t$Relapse-proofing the system: the floor, the resume-not-restart rule, and the data. You already have the evidence that you come back. This week we make coming back a protocol, not a hope.$t$,
 $j${"artifact":"Restart Protocol","intro":"Write your Restart Protocol in your own words.","prompts":["What 'restart, not start over' means for you","The first small move back after a gap","Where your floor and anchor fit the return"]}$j$::jsonb,
 $j$["Nothing new this week — just run the plan. This week is the proof it holds."]$j$::jsonb),

('prog_int_move_nourish', 14, 'KEEP GOING', $t$The Body You Live In$t$, true,
 $t$MILESTONE / GRADUATION. Riley reads your Session Zero 'why' back one more time, then names what changed.$t$,
 $t$Maintenance mode: what Riley keeps doing after today — referencing your plan in normal chat, seasonal check-ins if you opt in. The program becomes a set of tools you keep, and a coach who remembers.$t$,
 $j${"artifact":"Baseline v2 + Maintenance Plan + Becoming Statement","intro":"Re-run the baseline, see the delta, and name who you're becoming.","prompts":["Re-run the four-question baseline (stairs / floor-rise / sleep / 3pm energy)","Riley lays Baseline v1 and v2 side by side and names the delta","Write your Becoming Statement, body edition","Riley's one honest line about Coach's adaptive engines — once, then done"]}$j$::jsonb,
 $j$["Adopt your Maintenance Plan — the smallest version of the plan that keeps the gains, for the season ahead."]$j$::jsonb)

ON CONFLICT (program_key, session_number) DO UPDATE SET
  phase=EXCLUDED.phase, title=EXCLUDED.title, is_milestone=EXCLUDED.is_milestone,
  open_template=EXCLUDED.open_template, learn_body=EXCLUDED.learn_body,
  work_spec=EXCLUDED.work_spec, commit_options=EXCLUDED.commit_options, updated_at=now();
