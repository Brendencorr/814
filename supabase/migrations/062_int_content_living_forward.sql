-- ============================================================
-- 062_int_content_living_forward.sql — Living Forward (grief) session content (Phase 2)
--
-- Session Zero + 14 sessions for prog_int_grief, authored faithfully from the spec (doc 02 / PDF
-- §"LIVING FORWARD"). This is the program "closest to the brand's soul" — built the most carefully.
-- The session ORDER deliberately alternates loss-oriented (L) and restoration-oriented (R) sessions:
-- the alternation itself IS the Dual Process Model therapy, so the sequence is preserved exactly.
--
-- Accountability here is the gentlest in the catalog: COMMITs are framed as INTENTIONS, not tasks
-- ("how did the week hold you?", never "did you complete"). Cadence defaults to weekly (grief pacing).
-- Safety (strictest in catalog) lives in Session Zero + the crisis architecture at runtime: companion-
-- not-clinician; NEVER press for death details; banned phrases ("closure","move on","at least", ranking
-- loss); screens for recent loss / suicide-overdose-child loss / prolonged grief → warm referral.
-- Milestones (phase reviews) at 4/8/14. Requires 060. Run AFTER 060.
-- ============================================================

INSERT INTO int_sessions (program_key, session_number, phase, title, is_milestone, open_template, learn_body, work_spec, commit_options) VALUES

('prog_int_grief', 0, 'INTAKE', $t$Session Zero — I Remember$t$, false,
 $t$Riley opens with what it already knows about the loss — gently, by their word for the person: "You told me about your mom. If she's who you're carrying into this, I remember. If it's someone or something else — or more than one — tell me." A griever is never asked to re-explain their loss to a companion who should already know.$t$,
 $t$"I'm a companion, not a clinician. Some weights need more hands than mine, and I'll always say so honestly." And the promise: I will never rush you, never grade you, and never ask you to let go of them. We're not here to put the weight down — we're here to learn to carry it.$t$,
 $j${"artifact":"Session Zero (held privately)","intro":"The most delicate intake in the catalog — paced, and splittable across two sittings, because grief tires you fast. Riley never presses for death details.","prompts":["The loss itself: who or what, when, and only as much of how as you volunteer — and what you called them (Riley uses your word forever after)","The relationship's texture, the honest version — close, complicated, estranged, caregiving-exhausted (no judgment; complicated love makes complicated grief)","The dates that matter — birthday, the anniversary, holidays — written to the calendar so Riley shows up before them","Complicating factors, only if you choose: sudden or violent loss, overdose, suicide, loss of a child, losses stacked","Your support map: who knows, who helps, who makes it worse, whether you're grieving alone","Where the grief lives now — sleep, appetite, the hour of day it hits hardest (so Riley never sends a prompt into your 9pm wave)"]}$j$::jsonb,
 $j$["Your contract: your goal in your own words ('I don't want to feel like this forever' is enough), a gentle once-a-week rhythm, and how you want Riley to reach you."]$j$::jsonb),

('prog_int_grief', 1, 'GROUND', $t$The Story, At Your Pace$t$, false,
 $t$Riley opens softly, with no agenda but to listen.$t$,
 $t$There is no wrong way to do this. The neat 'stages' are a myth — waves are the real unit of grief, not phases. A wave can arrive a year in and knock you flat, and that is not backsliding. It's grief.$t$,
 $j${"artifact":"The Story v1 (saved only if you want it saved)","intro":"Tell Riley the story — as much or as little as you want, in your voice or in text. Riley listens, reflects, and never redirects.","prompts":["Say it however it comes out — there's no order it has to be in","Retelling is how the mind files what happened; the tenth telling counts like the first","Riley saves this only if you ask"]}$j$::jsonb,
 $j$["One act of basic care this week — a real meal, a walk, a shower on the hard day. An intention, not a task."]$j$::jsonb),

('prog_int_grief', 2, 'GROUND', $t$The Body Keeping Score$t$, false,
 $t$Riley opens by asking, gently, how the week held you — never whether you completed anything.$t$,
 $t$Grief is physiology, not weakness. The fog, the bone-tiredness, the appetite that vanished or won't quit — that's your body carrying what your mind can't yet. None of it means something is wrong with you.$t$,
 $j${"artifact":"The Weather Map","intro":"Map where the grief lives — in your body and across your day.","prompts":["Where you feel it physically","Your heavy hours — when it hits hardest","This map also quietly configures when Riley does and doesn't reach out"]}$j$::jsonb,
 $j$["Protect one body-basic every day this week — your choice which one. Sleep, water, food, air."]$j$::jsonb),

('prog_int_grief', 3, 'GROUND', $t$The Daily Check-In, Together$t$, false,
 $t$Riley opens on the body-basic you chose — how it held.$t$,
 $t$Containment with a door, not a wall. A two-minute daily appointment with the grief makes the other twenty-three hours and fifty-eight minutes more livable — because the grief knows it has a time that belongs to it.$t$,
 $j${"artifact":"Your Daily Grief Check-In","intro":"Run the check-in live with Riley once, so it's yours.","prompts":["Weather report: what's the grief like today","Body scan: where it's sitting","One memory or one mercy","The door closes — until tomorrow"]}$j$::jsonb,
 $j$["The check-in, daily this week — with Riley (a tap opens it) or alone. This becomes your spine: the gentlest accountability in the catalog."]$j$::jsonb),

('prog_int_grief', 4, 'THE WEIGHT', $t$The Hardest Parts$t$, true,
 $t$MILESTONE. Phase review, in your own words — Riley reflects back what these first weeks have been, without grading them.$t$,
 $t$The mind loops on the worst moments — the last day, the phone call, the things unsaid. That looping isn't you failing to cope. It's the mind trying to file something unfileable, running the tape until it can be set down.$t$,
 $j${"artifact":"Held privately","intro":"Expressive writing on ONE hard part — timed, with Riley holding the container.","prompts":["Choose one hard part — just one","Riley: 'I'm here. Write. I'll be here when the timer ends.'","Write until the timer stops; nothing has to be shown to anyone"]}$j$::jsonb,
 $j$["An intention only: notice one loop this week, and tell Riley about it at a check-in. Naming it is the whole task."]$j$::jsonb),

('prog_int_grief', 5, 'THE WEIGHT', $t$The Jobs They Left$t$, false,
 $t$Riley opens on the loop you noticed — with curiosity, never a checklist.$t$,
 $t$Every loss leaves vacant roles — the bill-payer, the one who called your sister, the reason you cooked real dinners. Learning those roles is not replacing the person. It's restoration, and restoration is not betrayal — it's how grief is meant to move.$t$,
 $j${"artifact":"The Roles List","intro":"Name the roles the loss left vacant, and sort them.","prompts":["List the roles they quietly held","Pick ONE to learn","Pick one to delegate, or to let go of entirely"]}$j$::jsonb,
 $j$["One concrete step on the learnable role — find the account login, make the call, cook the dinner."]$j$::jsonb),

('prog_int_grief', 6, 'THE WEIGHT', $t$Guilt, Anger, Relief$t$, false,
 $t$Riley opens gently — this session names the feelings almost nobody admits out loud.$t$,
 $t$Guilt runs on hindsight's lies — you decided with what you knew then, not what you know now. Anger is grief with adrenaline. And relief — especially after caregiving, addiction, or a hard relationship — is a nervous system finally exhaling. It is not betrayal.$t$,
 $j${"artifact":"The Unsent Letter","intro":"Identify which of the three is loudest for you, and write the letter it's been waiting to send.","prompts":["Name the feeling honestly — guilt, anger, relief, or the tangle of all three","Write the unsent letter","Riley will hold it in your shelf, or witness its deletion — both are honored endings"]}$j$::jsonb,
 $j$["An intention: one honest sentence about the feeling, to one safe human — or back to Riley."]$j$::jsonb),

('prog_int_grief', 7, 'THE WEIGHT', $t$The People Problem$t$, false,
 $t$Riley opens on how it felt to say the honest sentence — or that not saying it yet is okay too.$t$,
 $t$The platitude people. The grief police. The friends who disappeared. And — often overlooked — the ones who'd help if they only knew how. Most people aren't cruel; they're lost, and waiting to be told what you need.$t$,
 $j${"artifact":"My Companion Guide (shareable)","intro":"Build the guide that tells people what YOU need — and pick your scripts for the hardest ones.","prompts":["What you need people to know, do, and not say","Scripts for the top offender","This becomes a guide you can send"]}$j$::jsonb,
 $j$["Send the guide to one person, or use one script this week."]$j$::jsonb),

('prog_int_grief', 8, 'THE TURN', $t$Permission$t$, true,
 $t$MILESTONE. Riley reads back the first line of your Session 1 story and your check-in weather trend, and names the oscillation you're already doing: "You've had four quiet days in the last two weeks. A month ago there were none."$t$,
 $t$Joy without betrayal. The see-saw is a lie — grief and joy live in the same chest, the same hour. Your loyalty was never measured in how much you suffer. Letting a good thing be good does not subtract from them.$t$,
 $j${"artifact":"Five Things","intro":"List five things you would have enjoyed before.","prompts":["Small or large — anything that used to land as good","Don't rank them, just name them","Pick one to actually do"]}$j$::jsonb,
 $j$["Do one of the five. And when the guilt arrives on schedule, say the line: 'This doesn't mean I've forgotten. It means I'm carrying it well.'"]$j$::jsonb),

('prog_int_grief', 9, 'THE TURN', $t$The Firsts & The Dates$t$, false,
 $t$Riley opens with the dates from your intake already on the table — because the anniversary doesn't wait to be asked about.$t$,
 $t$The anticipation is almost always worse than the day itself. And a first that's decided-in-advance beats a first that ambushes you. We don't have to get it 'right' — we have to have a plan and an escape hatch.$t$,
 $j${"artifact":"The Firsts Plan (wired to Riley's calendar)","intro":"Plan the next approaching first, together.","prompts":["Attend, adapt, or skip — all are valid","Build the escape hatch in advance","Riley commits too: 'I'll check on you two days before, the morning of, and the day after. You won't face it unannounced.'"]}$j$::jsonb,
 $j$["Tell one person the plan, so you're not carrying the day alone."]$j$::jsonb),

('prog_int_grief', 10, 'THE TURN', $t$Rebuilding a Week$t$, false,
 $t$Riley opens on how the plan for the first is sitting with you.$t$,
 $t$Behavioral activation for the restoration side: small valued actions come BEFORE motivation, because motivation is one of the things grief took. You don't wait to feel like it. You do the small thing, and the feeling follows sometimes.$t$,
 $j${"artifact":"The Week v1","intro":"Design one week with three small anchors, placed into real days.","prompts":["One body anchor","One human anchor","One meaningful anchor"]}$j$::jsonb,
 $j$["Run the week as you designed it — Riley checks in gently along the way."]$j$::jsonb),

('prog_int_grief', 11, 'THE TURN', $t$Keeping Them With You$t$, false,
 $t$Riley opens on how the three anchors held the week.$t$,
 $t$Continuing bonds: the healthiest grievers don't detach — the bond changes form. The research is emphatic and the culture is wrong. The conversation you keep having with them, out loud in the car, is normal, common, and good.$t$,
 $j${"artifact":"The Ritual","intro":"Design the ritual that carries them with you.","prompts":["The object — a watch, a photo, a kept thing","The date kept, the meal cooked, the work done in their name","Make it something you can actually do"]}$j$::jsonb,
 $j$["Perform the ritual once this week."]$j$::jsonb),

('prog_int_grief', 12, 'LIVING FORWARD', $t$Who Am I Now$t$, false,
 $t$Riley opens on the ritual — what it felt like to carry them on purpose.$t$,
 $t$Identity after loss: you were someone's daughter, husband, caregiver. The role ended; the love didn't. Meaning reconstruction is the long, quiet work — not who you were, and not who you'll pretend to be, but who you're actually becoming.$t$,
 $j${"artifact":"Identity Inventory","intro":"Take inventory of what stays and what wants to grow.","prompts":["What of them lives in you now — habits, values, phrases, recipes","What of YOU is asking to grow"]}$j$::jsonb,
 $j$["One act this week that feeds the growing part."]$j$::jsonb),

('prog_int_grief', 13, 'LIVING FORWARD', $t$The Letter Forward$t$, false,
 $t$Riley opens knowing this is the capstone — and helps only as much as you ask.$t$,
 $t$This letter is not goodbye. It's an update. Everything that's happened, everything you're carrying, everything you're building, everything you want them to know.$t$,
 $j${"artifact":"The Letter Forward","intro":"Write the letter TO them — an update, not a farewell.","prompts":["What's happened, what you're carrying, what you're building","What you want them to know","Then, gently and skippable: if they could write back one sentence, what would it say? (Most people know. It's usually kind.)"]}$j$::jsonb,
 $j$["Keep the letter in your shelf, and keep the ritual and check-in as they serve you."]$j$::jsonb),

('prog_int_grief', 14, 'LIVING FORWARD', $t$The Living Forward Plan$t$, true,
 $t$MILESTONE / GRADUATION. Riley reads the whole arc back — Session 1's first line, the weather trend, the ritual, the letter.$t$,
 $t$You don't grow past grief; you grow around it. The grief stays its size — the life grows bigger around it. This program was the growing. And this is the one program whose proactive layer doesn't end: grief doesn't graduate, and neither does Riley — the date-aware check-ins continue, if you want them.$t$,
 $j${"artifact":"The Living Forward Plan + The Statement","intro":"Set what stays, and name who you're becoming.","prompts":["Which tools stay daily (the check-in, dialed to as-needed)","Which stay yearly (the Firsts Plan renews)","The ritual, and Riley's standing date-aware role","Becoming Statement, grief edition: 'I'm becoming someone who carries ___ — and still ___.'"]}$j$::jsonb,
 $j$["Keep the Living Forward Plan. Riley stays — before the dates, and whenever you come back."]$j$::jsonb)

ON CONFLICT (program_key, session_number) DO UPDATE SET
  phase=EXCLUDED.phase, title=EXCLUDED.title, is_milestone=EXCLUDED.is_milestone,
  open_template=EXCLUDED.open_template, learn_body=EXCLUDED.learn_body,
  work_spec=EXCLUDED.work_spec, commit_options=EXCLUDED.commit_options, updated_at=now();
