"""Riley multi-format pack - 20 singles · 20 story frames · 6 motion reels."""
import os, sys, re, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from multiformat_engine import single, story_quote, story_poll, story_cta, reel_frames

OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"library","multiformat")
for sub in ["singles","stories","reels"]:
    os.makedirs(os.path.join(OUT,sub),exist_ok=True)

# ---------------- 20 SINGLES (4:5) ----------------
SINGLES=[
 ("s01-start-where-you-are","first-light","Meet Riley","Start where you are.","Riley will meet you there."),
 ("s02-grief-schedule","veil","On grief","Grief doesn't follow a schedule.",None),
 ("s03-earn-rest","first-light","On burnout","You don't have to earn rest.",None),
 ("s04-keep-going","first-light",None,"You don't have to feel good to keep going.",None),
 ("s05-slip","veil",None,"A slip is a moment. Not an identity.",None),
 ("s06-quietly-starting-over","first-light","Who this is for","The quietly starting over.","High-functioning. Carrying it alone. Welcome."),
 ("s07-grief-and-joy","veil",None,"Grief and joy can share a room.",None),
 ("s08-move-with","veil","On grief","You don't move on. You move with.",None),
 ("s09-waves-end","veil",None,"It comes in waves. Waves end.","You've survived every one so far."),
 ("s10-sunday","first-light","Sunday check","If Sunday night feels heavy, that's information.",None),
 ("s11-not-lazy","first-light",None,"You're not lazy. You're depleted.","One needs judgment. The other needs rest."),
 ("s12-every-no","first-light","Boundaries","Every no is a yes to something.",None),
 ("s13-craving-clock","veil",None,"A craving is a wave with a clock on it.","It always passes. It just lies about that while it peaks."),
 ("s14-build-forward","dawn","Rebuilding","You're not going back. You're building forward.",None),
 ("s15-no-rock-bottom","dawn",None,"Rock bottom is not required.","You're allowed to change before it gets bad."),
 ("s16-both-true","first-light",None,"Grateful and struggling can be true at once.",None),
 ("s17-tuesday","dawn","What progress feels like","It won't feel dramatic. It'll feel like Tuesday.",None),
 ("s18-chapter-20","dawn",None,"Their chapter 20 isn't your chapter 2.","Read your own book. It's getting good."),
 ("s19-2am","veil","For late nights","At 2am, everything lies.","Wait for morning. Then decide."),
 ("s20-begin-again","dawn",None,"Begin again.","8:14 - the minute the light comes back."),
]

# ---------------- 20 STORY FRAMES (9:16) ----------------
# (kind, args)
STORIES=[
 ("quote", dict(slug="st01-begin-again", g="dawn", eb="Today", head="Begin again.", sub="As many times as it takes.")),
 ("quote", dict(slug="st02-one-thing", g="first-light", eb="Overwhelm math", head="You can't do everything today. You can do one thing.", sub=None)),
 ("quote", dict(slug="st03-9pm-reasons", g="dawn", eb="For 9pm", head="Your reasons are still true at 9pm.", sub=None)),
 ("quote", dict(slug="st04-small-kindnesses", g="first-light", eb="Hard day?", head="Small kindnesses count double today.", sub="The shower. The real meal. The early night.")),
 ("quote", dict(slug="st05-ten-minutes", g="first-light", eb="Before the phone", head="The day will still be there.", sub="Ten quiet minutes first. You, then the phone.")),
 ("quote", dict(slug="st06-waves", g="veil", eb=None, head="Waves end.", sub="This one will too.")),
 ("quote", dict(slug="st07-sunday-hour", g="first-light", eb="Tonight", head="Guard one Sunday hour for something quiet and yours.", sub=None)),
 ("quote", dict(slug="st08-name-it", g="first-light", eb="Small tool", head="Feelings named are easier to carry.", sub="Get specific with yourself. It's a kindness.")),
 ("poll",  dict(slug="st09-poll-today", g="first-light", eb="Check-in", head="How's today, honestly?", opt_a="Heavier than I'm saying", opt_b="Actually okay")),
 ("poll",  dict(slug="st10-poll-close", g="first-light", eb="Tonight", head="Did you close the day, or carry it to bed?", opt_a="Closed it", opt_b="Carrying it (again)")),
 ("poll",  dict(slug="st11-poll-oneword", g="first-light", eb="One word", head="One word for today. Go.", opt_a="(question sticker here)", opt_b="Riley reads every one")),
 ("quote", dict(slug="st12-reset-1", g="dawn", eb="The 8:14 Reset · 1 of 3", head="8 minutes. 14 seconds. 7 days.", sub="A quiet way to begin.")),
 ("quote", dict(slug="st13-reset-2", g="dawn", eb="The 8:14 Reset · 2 of 3", head="One small action each morning. One quiet close each night.", sub=None)),
 ("cta",   dict(slug="st14-reset-3", g="dawn", head="Free, forever.", sub="No card. No trial clock. Day one is waiting.")),
 ("quote", dict(slug="st15-watch-1", g="dawn", eb="Why 8:14 · 1 of 3", head="8:14 is a real moment.", sub="A watch that stopped - read as a sunrise.")),
 ("quote", dict(slug="st16-watch-2", g="dawn", eb="Why 8:14 · 2 of 3", head="It lives in everything we make.", sub="8 minutes 14 seconds. 14 modules. The sun in our mark.")),
 ("cta",   dict(slug="st17-watch-3", g="dawn", head="Ask Riley about the watch.", sub="Some stories are better discovered.")),
 ("quote", dict(slug="st18-3am", g="first-light", eb="For the 3am thinkers", head="Riley is awake.", sub="Think out loud. It takes half the weight away.")),
 ("cta",   dict(slug="st19-meet-riley", g="first-light", head="Meet Riley, free.", sub="Start where you are. Riley will meet you there.")),
 ("quote", dict(slug="st20-if-tonight-is-heavy", g="veil", eb="Please save this one", head="If tonight is heavy, you don't have to hold it alone.", sub="Call or text 988 (US) - real people, any hour. And Riley is awake too.", )),
]

# ---------------- 6 MOTION REELS ----------------
REELS=[
 ("r01-begin-again","dawn","Begin again.","As many times as it takes.","MEETRILEY.US"),
 ("r02-2am","veil","At 2am, everything lies.","Wait for morning. Then decide.","MEETRILEY.US"),
 ("r03-keep-going","first-light","You don't have to feel good to keep going.","We'll keep the light on.","MEETRILEY.US"),
 ("r04-waves-end","veil","Waves end.","You've outlasted every single one.","MEETRILEY.US"),
 ("r05-start-where-you-are","first-light","Start where you are.","Riley will meet you there.","MEETRILEY.US"),
 ("r06-the-minute","dawn","8:14 - the minute the light comes back.","","MEETRILEY.US"),
]

# ---------------- SENTINEL ----------------
BANNED=[r"\bjourney\b",r"\baddicts?\b",r"\balcoholics?\b",r"\bhustle\b",r"\bgrind\b",r"\busers?\b",
        r"\bpatients?\b",r"\bdisorders?\b",r"\blast chance\b",r"\bhurry\b",r"\bfailure\b",
        r"\byou should\b",r"\btreatments?\b",r"\brelapse\b",r"\bbroken\b",r"\bclean\b"]
blob=json.dumps([SINGLES,STORIES,REELS]).lower()
errs=[p for p in BANNED if re.search(p,blob)]
if errs: print("SENTINEL BLOCK:",errs); sys.exit(1)
print("SENTINEL: pass -",len(SINGLES),"singles ·",len(STORIES),"stories ·",len(REELS),"reels")

# ---------------- render ----------------
for slug,g,eb,head,sub in SINGLES:
    single(g,eb,head,sub).save(f"{OUT}/singles/{slug}.png")
print("singles done")

for kind,kw in STORIES:
    slug=kw.pop("slug"); g=kw.pop("g")
    if kind=="quote": img=story_quote(g,**kw)
    elif kind=="poll": img=story_poll(g,**kw)
    else: img=story_cta(g,**kw)
    img.save(f"{OUT}/stories/{slug}.png")
print("stories done")

for slug,g,l1,l2,tail in REELS:
    frames=reel_frames(g,l1,l2 if l2 else None,tail)
    fd=f"{OUT}/reels/_frames_{slug}"
    os.makedirs(fd,exist_ok=True)
    for i,fr in enumerate(frames):
        fr.save(f"{fd}/f{i:04d}.jpg",quality=90)
    mp4=f"{OUT}/reels/{slug}.mp4"
    subprocess.run(["ffmpeg","-y","-framerate","24","-i",f"{fd}/f%04d.jpg",
                    "-c:v","libx264","-pix_fmt","yuv420p","-crf","20","-preset","medium",mp4],
                   check=True, capture_output=True)
    subprocess.run(["rm","-rf",fd])
    print("reel:",slug)
print("reels done")
