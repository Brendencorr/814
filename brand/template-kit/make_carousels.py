"""The first 12 Riley Instagram carousels - copy locked, Sentinel-checked."""
import os, sys, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carousel_engine import *

C = []

C.append(dict(slug="01-start-where-you-are", ground="first-light", slides=[
  ("hook",  dict(eb="Meet Riley", head="Start where you are.", sub="Riley will meet you there.")),
  ("body",  dict(eb="No label required", head="Not sure if you have a problem? Good.", sub="That's exactly who this is for.")),
  ("list",  dict(eb="Whole person", head="Whatever you're carrying.", items=[
      "Grief that won't follow a schedule",
      "Burnout that rest doesn't seem to fix",
      "A habit you're quietly rethinking",
      "A body you're ready to rebuild",
      "All of it at once"])),
  ("body",  dict(head="You're not starting over.", sub="You're continuing - and you don't have to do it alone.")),
  ("signoff", dict(message="Meet Riley, free.", tagline="Free, forever. No appointments. No judgment.")),
]))

C.append(dict(slug="02-the-814-reset", ground="dawn", slides=[
  ("hook",  dict(eb="The 8:14 Reset", head="8 minutes. 14 seconds. 7 days.", sub="A quiet way to begin.")),
  ("body",  dict(head="One small action every morning.", sub="Not a life overhaul. One thing, done quietly, before the day gets loud.")),
  ("body",  dict(head="One quiet close every night.", sub="Two minutes to put the day down instead of carrying it to bed.")),
  ("body",  dict(head="Why 8:14?", sub="Ask Riley sometime. It's a good story.")),
  ("signoff", dict(message="The 8:14 Reset is free, forever.", tagline="Seven days. One small light at a time.")),
]))

C.append(dict(slug="03-on-grief", ground="veil", slides=[
  ("hook",  dict(eb="On grief", head="Grief doesn't follow a schedule.")),
  ("body",  dict(head="There is no falling behind.", sub="Six weeks, six months, six years. It takes what it takes.")),
  ("body",  dict(head="Hard days aren't setbacks.", sub="They're part of how love keeps speaking.")),
  ("body",  dict(head="You don't have to be okay to be doing this right.", sub="Showing up to the day counts. Even quietly. Even barely.")),
  ("signoff", dict(message="Whenever you want to talk - Riley listens.", tagline="At 2pm or 2am. No appointments.")),
]))

C.append(dict(slug="04-on-burnout", ground="first-light", slides=[
  ("hook",  dict(eb="On burnout", head="You don't have to earn rest.")),
  ("body",  dict(head="Rest isn't a reward for finishing.", sub="It's part of how anything gets finished.")),
  ("body",  dict(head="Doing less isn't giving up.", sub="Sometimes it's the most honest thing you've done in months.")),
  ("body",  dict(head="Start smaller than feels reasonable.", sub="Ten quiet minutes counts. So does closing one tab.")),
  ("signoff", dict(message="Put some of it down.", tagline="Riley can help you sort what's yours to carry.")),
]))

C.append(dict(slug="05-keep-going", ground="first-light", slides=[
  ("hook",  dict(eb="The 8:14 Reset · Day 3", head="You don't have to feel good to keep going.")),
  ("body",  dict(head="Motivation is weather.", sub="It comes and goes. Showing up can be climate.")),
  ("body",  dict(head="Do it imperfectly if you have to.", sub="A short walk. A real breakfast. One honest sentence.")),
  ("signoff", dict(message="Keep going.", tagline="We'll keep the light on.")),
]))

C.append(dict(slug="06-a-slip-is-a-moment", ground="veil", slides=[
  ("hook",  dict(eb="If last night didn't go as planned", head="A slip is a moment. Not an identity.")),
  ("body",  dict(head="What matters most is the next hour.", sub="Not the story you're telling yourself about the last one.")),
  ("body",  dict(head="Shame keeps score. We don't.", sub="Day counts measure time. They never measured worth.")),
  ("body",  dict(head="Come back. That's the whole assignment.", sub="Today can still count. It usually does.")),
  ("signoff", dict(message="No judgment here.", tagline="There never was.")),
]))

C.append(dict(slug="07-body-rebuild", ground="first-light", slides=[
  ("hook",  dict(eb="Body rebuild", head="Eight minutes is enough to begin.")),
  ("body",  dict(head="Movement isn't punishment.", sub="It's a way of being on your own side.")),
  ("body",  dict(head="No scale. No before-and-after.", sub="Just a body that carried you this far, learning it can be cared for.")),
  ("body",  dict(head="A stretch counts. A walk counts.", sub="Showing up counts. Start where you are.")),
  ("signoff", dict(message="Rebuild, gently.", tagline="Riley will meet you at eight minutes.")),
]))

C.append(dict(slug="08-why-814", ground="dawn", slides=[
  ("hook",  dict(eb="Why 8:14", head="The minute the light comes back.")),
  ("body",  dict(head="8:14 is a real moment.", sub="A watch that stopped - and a choice to read it as a sunrise.")),
  ("body",  dict(head="Every piece carries it.", sub="8 minutes 14 seconds a day. 14 modules. The sun in our mark.")),
  ("body",  dict(head="Some stories are better discovered.", sub="Ask Riley about the watch sometime.")),
  ("signoff", dict(message="The light comes back.", tagline="That's the whole idea.")),
]))

C.append(dict(slug="09-riley-remembers", ground="first-light", slides=[
  ("hook",  dict(eb="What makes Riley different", head="\u201cLast time, you told me\u2026\u201d", sub="Four words that change everything.")),
  ("body",  dict(head="Riley remembers.", sub="Not your data. Your story - the way a friend would.")),
  ("body",  dict(head="No starting over every conversation.", sub="The thread picks up right where you left it.")),
  ("body",  dict(head="Known is different from tracked.", sub="One feels like a system. The other feels like a friend.")),
  ("signoff", dict(message="Come be known.", tagline="Free, forever.")),
]))

C.append(dict(slug="10-words-matter", ground="first-light", slides=[
  ("hook",  dict(eb="Words matter", head="You are not a label.")),
  ("list",  dict(eb="Retired", head="Words we've put down.", items=[
      "\u201cBroken\u201d - you're not a thing that failed",
      "\u201cClean\u201d - you were never dirty",
      "\u201cRelapse\u201d - we say slip: a moment, not an identity",
      "Labels that turn a person into a diagnosis"])),
  ("list",  dict(eb="Kept", head="Words we keep.", items=[
      "Rebuild", "Continue", "Chapter", "Show up", "One day at a time"])),
  ("body",  dict(head="Language is how you treat yourself in sentences.", sub="Choose the kind ones. They hold more weight than they look.")),
  ("signoff", dict(message="Speak to yourself like someone worth rebuilding.", tagline="Riley always will.")),
]))

C.append(dict(slug="11-days-add-up", ground="dawn", slides=[
  ("hook",  dict(eb="One day at a time", head="Days add up quietly.")),
  ("stat",  dict(eb="Someone in the 8:14 family just hit", number="2,419", monoline="days · one at a time", sub="Counted one morning at a time. Through hard days too.")),
  ("body",  dict(head="You don't build a life all at once.", sub="You build a day you can live with. Then another.")),
  ("body",  dict(head="Today counts.", sub="That's the whole math.")),
  ("signoff", dict(message="One day. Then another.", tagline="Riley keeps count with you - never over you.")),
]))

C.append(dict(slug="12-who-this-is-for", ground="first-light", slides=[
  ("hook",  dict(eb="Who this is for", head="The quietly starting over.")),
  ("body",  dict(head="High-functioning. Carrying it alone.", sub="Fine at work. Tired everywhere else.")),
  ("body",  dict(head="No diagnosis required. No rock bottom either.", sub="The door doesn't check labels.")),
  ("body",  dict(head="Build a life you don't want to escape from.", sub="That's the work. Riley's here for all of it.")),
  ("signoff", dict(message="Meet Riley, free.", tagline="Start where you are. Riley will meet you there.")),
]))

# ---------------- SENTINEL - copy compliance gate ----------------
BANNED = [r"\bjourney\b", r"\baddict\b", r"\balcoholic\b", r"\bhustle\b", r"\bgrind\b",
          r"\bcrush(ing)? it\b", r"\busers?\b", r"\bpatients?\b", r"\bdisorder\b",
          r"\blast chance\b", r"\blimited time\b", r"\bhurry\b", r"\bdon'?t miss\b",
          r"\bfailure\b", r"\bshould have\b", r"\btreatment\b", r"\btransform your body\b"]
# carousel 10 quotes retired words deliberately (meta-use, in quotation marks)
META_OK = {"10-words-matter": [r"\bbroken\b", r"\bclean\b", r"\brelapse\b"]}
EXTRA = [r"\bbroken\b", r"\bclean\b", r"\brelapse\b"]

def sentinel(car):
    errs=[]
    text=json.dumps(car["slides"]).lower()
    for pat in BANNED:
        if re.search(pat,text): errs.append(f"{car['slug']}: banned '{pat}'")
    for pat in EXTRA:
        if re.search(pat,text) and pat not in META_OK.get(car["slug"],[]):
            errs.append(f"{car['slug']}: banned '{pat}'")
    return errs

all_errs=[]
for car in C: all_errs+=sentinel(car)
if all_errs:
    print("SENTINEL BLOCK:"); [print(" ",e) for e in all_errs]; sys.exit(1)
print("SENTINEL: all 12 carousels pass -", sum(len(c['slides']) for c in C), "slides")

# ---------------- render ----------------
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"library","carousels")
os.makedirs(OUT, exist_ok=True)
LAYOUTS=dict(hook=slide_hook, body=slide_body, list=slide_list, stat=slide_stat, signoff=slide_signoff)
manifest=[]
for car in C:
    d=os.path.join(OUT,car["slug"]); os.makedirs(d,exist_ok=True)
    for i,(kind,kw) in enumerate(car["slides"],1):
        fn=LAYOUTS[kind]
        if kind in ("hook","body","list","stat"):
            img=fn(car["ground"],**kw) if kind!="body" else slide_body(car["ground"],**kw)
        else:
            img=slide_signoff(car["ground"],**kw)
        p=os.path.join(d,f"slide-{i}.png")
        img.save(p)
        manifest.append(p)
print("rendered", len(manifest), "slides")
