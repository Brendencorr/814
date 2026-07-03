#!/usr/bin/env python3
import re, os
ROOT="/Users/brendencorr/814 backend"
home=open(os.path.join(ROOT,"home.html"),encoding="utf-8").read()

NEW_NAV='''<nav class="nav" id="nav">
  <div class="nav-inner">
    <a href="/home" class="logo"><span class="logo-sun"></span>Riley<span>.</span></a>
    <div class="nav-links">
      <a href="/home" class="nl">Home</a>
      <a href="/about" class="nl">About</a>
      <a href="/home#programs" class="nl">Programs</a>
      <a href="/pillars" class="nl">The Four Pillars</a>
      <a href="/resources" class="nl">Resources</a>
      <a href="https://riley.eight14.us/login" class="nl">Sign In</a>
      <a href="https://riley.eight14.us/login" class="btn btn-gold btn-sm">Get Started</a>
    </div>
  </div>
</nav>'''

NEW_FOOT_LINKS='''<div class="foot-links">
        <a href="/home">Home</a>
        <a href="/about">About</a>
        <a href="/home#programs">Programs</a>
        <a href="/pillars">The Four Pillars</a>
        <a href="/resources">Resources</a>
        <a href="/blog">Blog</a>
        <a href="/safety">Trust &amp; Safety</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/disclaimer">Disclaimer</a>
        <a href="/contact">Contact</a>
        <a href="https://riley.eight14.us/login">Sign In</a>
        <a href="https://riley.eight14.us/talk">Talk to Riley</a>
      </div>'''

home=re.sub(r'<nav class="nav" id="nav">.*?</nav>', lambda m: NEW_NAV, home, count=1, flags=re.DOTALL)
home=re.sub(r'<div class="foot-links">.*?</div>', lambda m: NEW_FOOT_LINKS, home, count=1, flags=re.DOTALL)
open(os.path.join(ROOT,"home.html"),"w",encoding="utf-8").write(home)

HEAD=home[:home.index("</head>")+len("</head>")]
NAV=re.search(r'<nav class="nav" id="nav">.*?</nav>', home, re.DOTALL).group(0)
FOOTER=re.search(r'<footer>.*?</footer>', home, re.DOTALL).group(0)
m=re.search(r'(<script>(?:(?!</script>).)*?io\.observe.*?</script>)', home, re.DOTALL)
TAILSCRIPT=m.group(1) if m else '<script>const nav=document.getElementById("nav");addEventListener("scroll",()=>{nav.style.background=scrollY>20?"rgba(10,9,8,0.9)":"rgba(10,9,8,0.72)"});const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:0.12});document.querySelectorAll(".reveal").forEach(el=>io.observe(el));</script>'

def page(title, body):
    head=HEAD.replace("<title>The 8:14 Project — Health, Sobriety & Wellness</title>", "<title>"+title+" — The 8:14 Project</title>")
    return head+"\n<body>\n"+NAV+"\n<main>\n"+body+"\n</main>\n"+FOOTER+"\n"+TAILSCRIPT+"\n</body>\n</html>\n"

about='''<header class="hero" style="padding:150px 0 60px">
  <div class="hero-glow"></div>
  <div class="wrap hero-inner about-hero">
    <div class="eyebrow">Our Story</div>
    <h1 style="font-size:clamp(38px,6vw,66px)">Why 8:14.</h1>
    <div class="lede">A time that keeps its promise.</div>
    <p class="body">There was a watch. A kid&rsquo;s watch, worn every single day &mdash; the kind a child never takes off, because it makes them feel a little more grown, a little more themselves. And no matter when you looked at it, it always read 8:14. Ask him the time, and the answer never changed. It became the family&rsquo;s favorite running joke.</p>
    <p class="body">He never grew out of it. Years later, still wearing that same watch, it finally stopped &mdash; and of all the moments it could have chosen, it stopped at 8:14.</p>
    <p class="body">He&rsquo;s gone now. But 8:14 stayed behind. And now, every time a clock reads 8:14 &mdash; on a microwave, a dashboard, a phone you almost reached for &mdash; it lands like a hand on the shoulder. A reminder that the people we love are never as far as they feel. That presence outlasts loss. That none of us is walking this alone.</p>
  </div>
</header>
<section class="section band"><div class="wrap about-split">
  <div class="as-head">
    <div class="eyebrow">Why this exists</div>
    <div class="h2">Built the hard way.</div>
  </div>
  <div class="as-body">
    <p class="sub">I didn&rsquo;t build this from a textbook. I built it from the years I spent losing myself.</p>
    <p class="sub">For a long time I looked fine &mdash; successful, even. Inside, I was numbing, hiding, and surviving days I didn&rsquo;t know how to face. It took a breaking point, and finally admitting I couldn&rsquo;t do it alone, to start finding my way back.</p>
    <p class="sub">What followed wasn&rsquo;t a clean comeback. It was getting sober and learning to feel everything I&rsquo;d been running from. The end of a marriage, and grieving a future I thought was mine. Starting over somewhere new, learning how to breathe again. And a loss that rearranged the way the whole world feels.</p>
    <p class="sub">I&rsquo;m still becoming who I&rsquo;m meant to be. But I learned something I wish I&rsquo;d known at the bottom: <strong style="color:var(--parchment);font-weight:500">a life can fall apart and still become beautiful.</strong> Sometimes more beautiful &mdash; because it&rsquo;s finally real.</p>
    <p class="sub">This exists so you don&rsquo;t have to find that out alone.</p>
  </div>
</div></section>
<section class="section"><div class="wrap center" style="max-width:880px">
  <div class="eyebrow mt-e">Who it&rsquo;s for</div>
  <div class="h2">Wherever you are.</div>
  <p class="sub" style="margin:18px auto 0;font-size:18px;line-height:1.85">You don&rsquo;t need a diagnosis to deserve support. A person can look successful and still be suffering &mdash; can be surrounded by people and still feel completely alone. Whether you&rsquo;re deep in recovery, quietly starting over, holding grief and hope in the same hand, or just lost and trying to find yourself again, this was built for you. Built from experience, so you don&rsquo;t have to go through it in the dark.</p>
</div></section>
<section class="section band"><div class="wrap riley">
  <div class="reveal">
    <div class="eyebrow">Meet Riley</div>
    <h2>A steady presence.<br>Any hour.</h2>
    <p>Riley is the companion I wished existed in the hardest chapters. Not a therapist. Not a program with a script.</p>
    <p>She shows up the way the people who saved me did &mdash; <strong>not with lectures or judgment, but with calm, patience, and understanding.</strong></p>
    <p>Available any hour, because 8:14 doesn&rsquo;t keep office hours.</p>
    <a href="https://riley.eight14.us/talk" class="btn btn-ghost btn-lg" style="margin-top:12px">Talk to Riley &rarr;</a>
  </div>
  <div class="herologo reveal" style="--size:min(430px,84vw)"><div class="orb"></div><div class="tag">8:14<span>.</span></div></div>
</div></section>
<section class="finalcta"><div class="wrap">
  <div class="eyebrow mt-e">Begin</div>
  <h2>Start where you are.</h2>
  <p>Riley will meet you there. The rest of your life can start today.</p>
  <a href="https://riley.eight14.us/login" class="btn btn-gold btn-lg">Get started free</a>
</div></section>'''

PILLARS=[
 ("🌅","Sobriety &amp; Recovery","Whether you're two thousand days in or still deciding, Riley meets you exactly where you are. Recovery isn't a single chapter you finish — it's a way of living. Milestones honored, not just measured, and a steady presence for the quiet choices nobody claps for."),
 ("🤍","Movement as Medicine","Not punishment. Not performance. Movement that fits your real body and your real life — the kind that clears your head and settles your nervous system, because how you feel in your body and how you feel in your mind were never separate."),
 ("🍃","Food That Heals","Nourishment over rules. Food that steadies your mood, your energy, and your gut — built around who you are, not a diet someone else designed for a different life."),
 ("🏔️","The Rebuild","Sobriety, movement, and food woven into one path — plus purpose, relationships, and the whole life you're quietly rebuilding underneath it all. Not going back to who you were, but becoming someone more honest because of what broke."),
]
pblocks="".join(['<div class="reveal" style="display:flex;gap:22px;align-items:flex-start;padding:26px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="font-size:40px;flex-shrink:0;line-height:1">'+i+'</div><div><div class="h2" style="font-size:clamp(24px,3.2vw,32px)">'+t+'</div><p class="sub" style="margin-top:10px">'+d+'</p></div></div>' for i,t,d in PILLARS])
pillars='''<header class="hero" style="padding:150px 0 60px">
  <div class="hero-glow"></div>
  <div class="wrap hero-inner">
    <div class="eyebrow">The Four Pillars</div>
    <h1 style="font-size:clamp(38px,6vw,64px)">Everything Riley is built on.</h1>
    <p class="body">Four ways back to yourself. Riley doesn't treat them as separate tracks — she weaves them into one path, meeting you wherever you're starting. No topic is ever locked; you just choose how much support you want.</p>
  </div>
</header>
<section class="section" style="padding-top:20px"><div class="wrap" style="max-width:820px">'''+pblocks+'''</div></section>
<section class="finalcta"><div class="wrap">
  <div class="eyebrow mt-e">Begin</div>
  <h2>One path. One day at a time.</h2>
  <a href="https://riley.eight14.us/login" class="btn btn-gold btn-lg">Start free</a>
</div></section>'''

resources='''<header class="hero" style="padding:150px 0 60px">
  <div class="hero-glow"></div>
  <div class="wrap hero-inner">
    <div class="eyebrow">Resources</div>
    <h1 style="font-size:clamp(38px,6vw,64px)">You're not alone.</h1>
    <p class="body">If today feels heavy, start here. These lines are free, confidential, and open right now — no account, no cost. And you never have to wait until things feel unbearable to reach out.</p>
  </div>
</header>
<section class="section band"><div class="wrap" style="max-width:760px">
  <div class="eyebrow center" style="display:block;margin-bottom:8px">Immediate Support</div>
  <div style="display:flex;flex-direction:column;gap:14px;margin-top:22px">
    <div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.18);border-radius:10px;padding:20px 22px">
      <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--parchment);margin-bottom:4px">988 Suicide &amp; Crisis Lifeline</div>
      <div style="font-size:14px;color:var(--smoke);line-height:1.7">Call or text <strong style="color:var(--gold2)">988</strong> &mdash; 24/7, free and confidential, for anyone in emotional distress or crisis.</div>
    </div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:20px 22px">
      <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--parchment);margin-bottom:4px">SAMHSA National Helpline</div>
      <div style="font-size:14px;color:var(--smoke);line-height:1.7">Call <strong style="color:var(--gold2)">1-800-662-4357</strong> &mdash; 24/7, free and confidential treatment referral and information for substance use and mental health.</div>
    </div>
    <div style="font-size:13px;color:var(--smoke2);text-align:center;margin-top:6px">If you're in immediate danger, call <strong style="color:var(--parchment)">911</strong>.</div>
  </div>
</div></section>
<section class="section"><div class="wrap center">
  <div class="eyebrow mt-e">Learn &amp; Grow</div>
  <div class="h2">Tools we lean on.</div>
  <p class="sub" style="margin:16px auto 30px">A living shelf of the books, voices, and practices that actually helped — the ones Riley leans on too. More coming.</p>
  <div class="pillars">
    <div class="pillar reveal"><div class="icon">\U0001F4DA</div><h4>This Naked Mind</h4></div>
    <div class="pillar reveal"><div class="icon">\U0001F4DA</div><h4>Atomic Habits</h4></div>
    <div class="pillar reveal"><div class="icon">\U0001F3A7</div><h4>Huberman Lab</h4></div>
    <div class="pillar reveal"><div class="icon">\U0001F9D8</div><h4>Daily Practice</h4></div>
  </div>
</div></section>
<section class="finalcta"><div class="wrap">
  <div class="eyebrow mt-e">Begin</div>
  <h2>Riley is here, any hour.</h2>
  <a href="https://riley.eight14.us/talk" class="btn btn-gold btn-lg">Talk to Riley</a>
</div></section>'''

blog='''<header class="hero" style="padding:150px 0 60px">
  <div class="hero-glow"></div>
  <div class="wrap hero-inner">
    <div class="eyebrow">The Journal</div>
    <h1 style="font-size:clamp(38px,6vw,64px)">Stories, science &amp;<br>small reminders.</h1>
    <p class="body">Honest writing on sobriety, movement, food, grief, and the long work of rebuilding a life. No highlight reels — just the real, ordinary middle. Coming soon.</p>
  </div>
</header>
<section class="section band"><div class="wrap">
  <div class="prog-grid">
    <div class="pcard reveal"><div class="ptag">Coming soon</div><h3 style="font-size:20px">Why 8:14.</h3><div class="pdesc">The story behind the name &mdash; and how the smallest, most ordinary moments become the ones that carry us.</div></div>
    <div class="pcard reveal"><div class="ptag">Coming soon</div><h3 style="font-size:20px">Not sure if you have a problem?</h3><div class="pdesc">Most of the wellness world is built for people who already know. This is for everyone still wondering.</div></div>
    <div class="pcard reveal"><div class="ptag">Coming soon</div><h3 style="font-size:20px">When grief and recovery share a day</h3><div class="pdesc">You don't have to choose which one gets to matter. Some seasons ask you to carry both.</div></div>
  </div>
</div></section>
<section class="finalcta"><div class="wrap">
  <div class="eyebrow mt-e">Be first</div>
  <h2>The first stories are coming.</h2>
  <p>Start free, and you'll be the first to read them.</p>
  <a href="https://riley.eight14.us/login" class="btn btn-gold btn-lg">Start free</a>
</div></section>'''

for fname,title,body in [("about.html","About",about),("pillars.html","The Four Pillars",pillars),("resources.html","Resources",resources),("blog.html","The Journal",blog)]:
    open(os.path.join(ROOT,fname),"w",encoding="utf-8").write(page(title,body))
    print("wrote",fname)
print("updated home.html nav + footer; TAILSCRIPT len", len(TAILSCRIPT))
