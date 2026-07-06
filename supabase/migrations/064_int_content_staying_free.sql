-- ============================================================
-- 064_int_content_staying_free.sql — Staying Free session content (Phase 2)
--
-- Session Zero + 14 sessions for prog_int_staying_free, authored faithfully from doc 05. Transdiagnostic
-- relapse prevention / staying-on-track coaching for WHATEVER the person is staying free from (substances
-- are first-class but one door among several — the brand never leads with sobriety). Evidence: Marlatt
-- relapse prevention, urge surfing, implementation intentions, social-support activation, identity change.
--
-- Signature machinery (built in Phase 4, not here): the lapse-repair state (lapse_first_response canon
-- fires FIRST — interim seeded in 060, founder version pending) + the free stabilization pack (all tiers).
-- Safety (co-strictest with grief): PHYSICAL-DEPENDENCE GATE in Session Zero (heavy daily alcohol/benzo/
-- opioid → medical-detox guidance BEFORE any abstinence planning — the one place Riley overrides "their
-- goal"); never diagnose/moralize/shame; banned lexicon (clean/dirty/wagon/willpower); disordered-eating
-- routes to care, never coached as a pattern. Phases GROUND(1-4)/PROTECT(5-8)/REBUILD(9-11)/STAY FREE(12-14);
-- milestones 4/8/14. Requires 060. Run AFTER 060.
-- ============================================================

INSERT INTO int_sessions (program_key, session_number, phase, title, is_milestone, open_template, learn_body, work_spec, commit_options) VALUES

('prog_int_staying_free', 0, 'INTAKE', $t$Session Zero — What You're Staying Free From$t$, false,
 $t$Riley confirms known history first — any slips disclosed in chat, Reset persona, self-guided Sobriety progress if owned — then asks, in your words, what you're staying free from. Whatever it is is fully and unflinchingly served here.$t$,
 $t$"I'm a companion, not a clinician or a program of record. If you ever need medical help, real-world community (SMART, AA, or whatever fits you), or crisis support, I'll always help you find it — that's not a failure of this program, it's part of it." And the promise: I'm not here to catch you failing. I'm here to help you catch yourself early. If a bad day comes, I'll be the first voice that isn't ashamed of you.$t$,
 $j${"artifact":"Session Zero (held privately)","intro":"An honest intake. One safety note up front: if you're using alcohol, benzos, or opioids heavily every day, stopping cold can be dangerous — Riley will walk you to a doctor first, calmly, before any plan.","prompts":["What you're staying free from, and your definition of 'free' (abstinence, moderation with a hard line, pattern-breaking) — Riley coaches YOUR goal","The history, told once: how long, prior quits and what ended them (each attempt is a scouting report, not a failure), the longest stretch free and what made it work","Trigger inventory v1 — people, places, times, feelings, events: 'Walk me through the last time it nearly got you. Where were you, who was around, what had the day been like?'","The high-risk calendar — the wedding, the conference, the anniversary, the ex's birthday — written to your calendar so Riley shows up before them","Support map: who knows, who helps, who's a hazard, and whether anyone could be a named Trusted Person","Stakes, in your words: what staying free is FOR — the mornings, the kid, the self-respect (kept verbatim; returns at Session 7 and 14)"]}$j$::jsonb,
 $j$["Your contract: a twice-a-week rhythm (or once, if the early days feel heavy), how you want Riley to reach you, and — if there's daily heavy use — a doctor conversation before we plan anything."]$j$::jsonb),

('prog_int_staying_free', 1, 'GROUND', $t$Free Days by Design$t$, false,
 $t$Riley opens ready to build, not to lecture.$t$,
 $t$Staying free is architecture, not willpower — the structure of the day does the heavy lifting so you don't have to out-muscle a craving at 9pm. The floor is the minimum day that keeps you on your side: a sleep window, one real meal, one movement, one point of contact.$t$,
 $j${"artifact":"My Floor v1","intro":"Build your floor from your real life.","prompts":["Your sleep window","One real meal","One movement","One point of contact with another person"]}$j$::jsonb,
 $j$["Run the floor daily this week; one tap to confirm. On the worst day, the floor is the whole win."]$j$::jsonb),

('prog_int_staying_free', 2, 'GROUND', $t$Urge Literacy$t$, false,
 $t$Riley opens on how the floor held.$t$,
 $t$The wave: urges crest and fall in minutes whether or not you act — the surfing stance (observe, name, ride) starves it, the fighting stance feeds it. And HALT — hungry, angry, lonely, tired — turns a small urge into a big one.$t$,
 $j${"artifact":"My Interrupt Menu","intro":"Personalize your Craving Interrupt Menu — your top three interrupts, ordered by situation.","prompts":["At home","At work","In company","Built from the Emergency Craving Protocol, the 8-Minute Reset, and your own history of what's worked"]}$j$::jsonb,
 $j$["Next urge, run the menu and time the wave — see for yourself how fast it crests and falls."]$j$::jsonb),

('prog_int_staying_free', 3, 'GROUND', $t$The Trigger Map, Coached$t$, false,
 $t$Riley opens on the wave you timed — and gently probes the triggers you might be avoiding naming.$t$,
 $t$Triggers are calendar entries, not character flaws. There are four columns — people, places, times, feelings — and the dangerous ones are compound: tired + alone + Friday.$t$,
 $j${"artifact":"The Trigger Map (living document)","intro":"Expand your Trigger Map from Session Zero's seed, live.","prompts":["People, places, times, feelings","The compound triggers — the combinations that stack","This map keeps updating all program long"]}$j$::jsonb,
 $j$["This week, log one trigger encounter at the daily tap — what fired, and what you did."]$j$::jsonb),

('prog_int_staying_free', 4, 'GROUND', $t$Environment Design$t$, true,
 $t$MILESTONE. Phase review — your Trigger Map already has real entries in it now.$t$,
 $t$Environment beats willpower every time. The home audit: what's in the house, what's one tap away on the phone, what route home passes the old place. You don't have to be strong if you're not standing in front of it.$t$,
 $j${"artifact":"Environment Changes","intro":"Choose three environment changes, sized to your courage today.","prompts":["What's in the house","What's one tap away on the phone","What route or place to reroute around"]}$j$::jsonb,
 $j$["Make the three changes this week; photo-confirm if you want to."]$j$::jsonb),

('prog_int_staying_free', 5, 'PROTECT', $t$The High-Risk Date Plan$t$, false,
 $t$Riley opens with the next high-risk date from your calendar already on the table.$t$,
 $t$Ambush versus appointment: decided-in-advance beats in-the-moment for every high-risk event. The exit plan, the drink-in-hand strategy, the drive-yourself rule — these are how you walk in already knowing how you walk out.$t$,
 $j${"artifact":"High-Risk Date Plan v1","intro":"Take the NEXT date on your calendar and plan it fully. This template is reused for every future date; Riley initiates T-2 / day-of / T+1.","prompts":["Arrival and your anchor person","Standing drink or replacement","Exit line and escape hatch","Riley's check-in schedule around it"]}$j$::jsonb,
 $j$["Brief one person on the plan before the date."]$j$::jsonb),

('prog_int_staying_free', 6, 'PROTECT', $t$Scripts & Social Armor$t$, false,
 $t$Riley opens on how the date plan sits with you, then offers to play the hard people.$t$,
 $t$The pusher, the "just one" chorus, the awkward silence — met with the broken-record technique. And disclosure has tiers: deflect, honest-lite, or the real one — in YOUR voice, for YOUR people. You don't owe anyone the whole truth to keep yourself safe.$t$,
 $j${"artifact":"My Scripts","intro":"Write and rehearse your scripts — Riley role-plays the brother-in-law.","prompts":["Your broken-record line","Your three disclosure tiers","Rehearse until they come out without effort"]}$j$::jsonb,
 $j$["Deploy one script at a real moment this week."]$j$::jsonb),

('prog_int_staying_free', 7, 'PROTECT', $t$The Trusted People Card$t$, false,
 $t$Riley opens by reading your Session Zero stakes back to you — what this is FOR — before the ask.$t$,
 $t$Support activation is the single strongest protective factor there is — and the hardest ask for people who hate being a burden. The reframe: letting someone help you IS the relationship, not a debt against it.$t$,
 $j${"artifact":"Trusted People Card + shareable guide","intro":"Name 1-3 Trusted People and write them the guide. Riley never contacts them for you — this card is YOUR tool, surfaced at risk moments ('This might be a moment for [name]. Want their number on screen?').","prompts":["Name 1-3 Trusted People","Write the 'What I Need You to Know' guide: what helps, what doesn't, what to do if I call at a bad hour","Their contact is stored only with your explicit consent"]}$j$::jsonb,
 $j$["Send the guide to one person."]$j$::jsonb),

('prog_int_staying_free', 8, 'PROTECT', $t$The Boredom Problem$t$, true,
 $t$MILESTONE. Phase review — your protection stack is complete now: floor, menu, map, date plans, scripts, people.$t$,
 $t$The pattern compressed all your reward into one lever, so free time early on can feel like empty time. Dopamine recovers on its own schedule, and boredom is chemistry, not a verdict on your new life.$t$,
 $j${"artifact":"The Rebuild List","intro":"List ten things that cost nothing and need no substance.","prompts":["Ten small, free, substance-free things","Pick the easiest one","No pressure for it to be meaningful — easy is the point"]}$j$::jsonb,
 $j$["Do the easiest one once this week, boredom notwithstanding."]$j$::jsonb),

('prog_int_staying_free', 9, 'REBUILD', $t$Shame, Out Loud$t$, false,
 $t$Riley opens gently — this is the one that's been waiting.$t$,
 $t$Shame is the pattern's best friend: it isolates, and isolation feeds the pattern. Guilt says "I did a bad thing"; shame says "I am the bad thing" — and that distinction is load-bearing. Secrets metastasize; witnessed things shrink.$t$,
 $j${"artifact":"Held privately","intro":"Expressive writing — the thing you've never said out loud about the pattern. Riley holds the container and never grades.","prompts":["Write the thing you've never said","No one has to read it","Riley is here when the timer ends"]}$j$::jsonb,
 $j$["An intention: one honest sentence to one safe human, or back to Riley."]$j$::jsonb),

('prog_int_staying_free', 10, 'REBUILD', $t$The Identity Shift$t$, false,
 $t$Riley opens by reading your own data back to you — floors kept, waves surfed, dates survived.$t$,
 $t$"Staying free" is something you're building toward, not just abstaining from. Every kept floor-day is a vote for who you're becoming. And watch the pattern-identity trap in both directions — "I'm just a partier" and "I'm only my recovery" are both cages.$t$,
 $j${"artifact":"Evidence Inventory","intro":"Let the confirmation record show you who you're becoming.","prompts":["What the data proves — the floors, the waves, the dates","Who that person is, in your words","What still surprises you about it"]}$j$::jsonb,
 $j$["One act this week that belongs to the NEW identity and has nothing to do with the old pattern."]$j$::jsonb),

('prog_int_staying_free', 11, 'REBUILD', $t$The Fast Re-entry Protocol$t$, false,
 $t$Riley opens by explaining why this session comes now, before it's needed — like a fire drill you run in daylight. (If a slip is ever disclosed, Riley's very first words are founder canon — care before any steps — then this protocol.)$t$,
 $t$The abstinence-violation effect — "I blew it, so why stop now" — is the actual killer, and it's disarmable in advance. A slip is a data point that reveals a gap in the map, not a deletion of the record. Nothing you built gets erased.$t$,
 $j${"artifact":"My Fast Re-entry Protocol","intro":"Write it now, while it's theoretical — personalized from the Slip Response Protocol. Pinned beside your Interrupt Menu.","prompts":["The first hour: no inventory tonight — water, food, sleep","The next morning: three questions on paper","The map update: what did this teach us","The one person told, and the resume-not-restart rule"]}$j$::jsonb,
 $j$["Read it once now, out loud if you can, while it's still just a plan."]$j$::jsonb),

('prog_int_staying_free', 12, 'STAY FREE', $t$The Long Game$t$, false,
 $t$Riley opens on what the Fast Re-entry Protocol felt like to write.$t$,
 $t$What months 2, 6, and 12 actually look like: the pink cloud, the wall, and the ordinary Tuesday you didn't think about it once. Milestones matter — the 30-day ritual is doing something the old pattern made impossible. And risk quietly rises when things feel handled: complacency is a trigger with good PR.$t$,
 $j${"artifact":"Milestones & Rituals","intro":"Place your milestones and rituals on the calendar — Riley shows up for the good dates too.","prompts":["Your milestone dates","The ritual for each (something the old pattern made impossible)","Written to your calendar as celebrations"]}$j$::jsonb,
 $j$["Schedule the next milestone marker."]$j$::jsonb),

('prog_int_staying_free', 13, 'STAY FREE', $t$The Maintenance Architecture$t$, false,
 $t$Riley opens on the milestone you scheduled — and what marking it will mean.$t$,
 $t$Which tools stay forever versus which retire: the Interrupt Menu and Fast Re-entry stay pinned for life; the Trigger Map gets a quarterly review; the floor flexes with the seasons; high-risk dates renew annually.$t$,
 $j${"artifact":"The Staying Free Plan","intro":"Build your permanent kit — plus the early-warning list.","prompts":["Your permanent tool kit","The early-warning list: the three signs, in your own words, that you're drifting (skipped floors, dodged check-ins, 'I'm fine' answers)"]}$j$::jsonb,
 $j$["Share the early-warning list with your Trusted Person."]$j$::jsonb),

('prog_int_staying_free', 14, 'STAY FREE', $t$Becoming$t$, true,
 $t$MILESTONE / GRADUATION. Riley reads Session Zero's stakes back to you verbatim, then the whole arc — the confirmation record, the waves surfed, the dates survived, the map that got smarter.$t$,
 $t$Maintenance mode, honestly: Riley's standing role doesn't end. The date-aware check-ins persist (high-risk and milestone dates both), the lapse-repair state stays armed forever, and the early-warning signs are now something Riley quietly watches for in ordinary chat — with your consent.$t$,
 $j${"artifact":"The Statement + The Staying Free Plan (final)","intro":"Name who you've become.","prompts":["Becoming Statement, freedom edition: 'I'm becoming someone who ______, even when ______.'","Finalize the Plan","One honest line about Coach, if you're not on it — once, then done"]}$j$::jsonb,
 $j$["Keep the Plan and the armed lapse-repair state. Riley stays — before the dates, and the moment you ever need to catch yourself early."]$j$::jsonb)

ON CONFLICT (program_key, session_number) DO UPDATE SET
  phase=EXCLUDED.phase, title=EXCLUDED.title, is_milestone=EXCLUDED.is_milestone,
  open_template=EXCLUDED.open_template, learn_body=EXCLUDED.learn_body,
  work_spec=EXCLUDED.work_spec, commit_options=EXCLUDED.commit_options, updated_at=now();
