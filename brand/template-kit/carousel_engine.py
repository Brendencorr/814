"""Riley — Instagram carousel generator. Brand Guidelines v2.1 / Template System v1.0.
Renders 1080x1080 slides on the six LOCKED grounds (loaded from ./grounds/*.png).
Production fonts: DM Serif Display / DM Sans / DM Mono, bundled in ./fonts/."""
import os, json
from PIL import Image, ImageDraw, ImageFilter, ImageFont

KIT = os.path.dirname(os.path.abspath(__file__))   # the template-kit dir (portable)
GROUNDS_DIR = os.path.join(KIT, "grounds")

S = 1080
M = 104              # side margin
INK      = (10, 9, 8)
PARCH    = (245, 240, 232)
GOLD     = (201, 168, 76)
GOLD_LT  = (232, 213, 163)
SMOKE    = (138, 133, 120)

def font_path(candidates):
    for c in candidates:
        if os.path.exists(c): return c
    raise RuntimeError("no font found: " + str(candidates))

# bundled DM fonts first (reproducible), then system installs, then stand-ins (proofs only)
SERIF = font_path([
    os.path.join(KIT, "fonts", "DMSerifDisplay-Regular.ttf"),
    "/usr/share/fonts/truetype/dm/DMSerifDisplay-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"])
SERIF_IT = font_path([
    os.path.join(KIT, "fonts", "DMSerifDisplay-Italic.ttf"),
    "/usr/share/fonts/truetype/dm/DMSerifDisplay-Italic.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf"])
SANS = font_path([
    os.path.join(KIT, "fonts", "DMSans-Regular.ttf"),
    "/usr/share/fonts/truetype/dm/DMSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"])
MONO = font_path([
    os.path.join(KIT, "fonts", "DMMono-Regular.ttf"),
    "/usr/share/fonts/truetype/dm/DMMono-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"])

# ---------------- the six LOCKED grounds (spec section 1) ----------------
# Loaded from pre-rendered PNGs — never procedurally regenerated. Anything not
# in this set (Beam, Ember, Horizon, ...) is retired and raises.
LOCKED_GROUNDS = {"dawn", "first-light", "veil", "parchment", "framed", "first-blush"}
# normalize legacy hyphen-less spellings only; retired grounds are NOT aliased (they must raise)
GROUND_ALIASES = {"firstlight": "first-light", "first_light": "first-light",
                  "firstblush": "first-blush", "first_blush": "first-blush"}

def resolve_ground(kind):
    k = GROUND_ALIASES.get(kind, kind)
    if k not in LOCKED_GROUNDS:
        raise ValueError(
            f"'{kind}' is not one of the six locked grounds "
            f"{sorted(LOCKED_GROUNDS)} (Template Spec section 1). Beam/Ember/etc. are retired.")
    return k

def ground(kind, fmt="square-1080x1080"):
    name = resolve_ground(kind)
    return Image.open(os.path.join(GROUNDS_DIR, f"{name}--{fmt}.png")).convert("RGB")

# ---------------- typography engine ----------------
def wrap(draw, text, font, maxw):
    words=text.split(); lines=[]; cur=""
    for w in words:
        t=(cur+" "+w).strip()
        if draw.textlength(t,font=font)<=maxw: cur=t
        else:
            if cur: lines.append(cur)
            cur=w
    if cur: lines.append(cur)
    return lines

def fit(draw, text, path, start, maxw, maxh, lh=1.16, minsize=30):
    size=start
    while size>minsize:
        f=ImageFont.truetype(path,size)
        lines=wrap(draw,text,f,maxw)
        h=len(lines)*int(size*lh)
        if h<=maxh and all(draw.textlength(l,font=f)<=maxw for l in lines):
            return f,lines,int(size*lh)
        size-=4
    f=ImageFont.truetype(path,minsize)
    return f,wrap(draw,text,f,maxw),int(minsize*lh)

def draw_tracked(draw, xy, text, font, fill, tracking):
    x,y=xy
    for ch in text:
        draw.text((x,y),ch,font=font,fill=fill)
        x+=draw.textlength(ch,font=font)+tracking
    return x

def tracked_width(draw, text, font, tracking):
    return sum(draw.textlength(c,font=font) for c in text)+tracking*max(0,len(text)-1)

def eyebrow(draw, text, y=118, color=GOLD, size=26):
    f=ImageFont.truetype(MONO,size); t=text.upper(); tr=size*0.34
    w=tracked_width(draw,t,f,tr)
    draw_tracked(draw,((S-w)/2,y),t,f,color,tr)

def footer(draw, text=None):
    pass  # replaced by nav_footer(img) — launch phase uses Assets 1 & 2 only

def headline(draw, text, cy, maxw=S-2*M, maxh=560, start=96, color=PARCH, gold_period=True, italic=False, align="center", x0=M):
    path=SERIF_IT if italic else SERIF
    f,lines,lh=fit(draw,text,path,start,maxw,maxh)
    total=len(lines)*lh
    y=cy-total//2
    for i,line in enumerate(lines):
        last=(i==len(lines)-1)
        gp=gold_period and last and line.endswith('.') and not line.endswith('..')
        body=line[:-1] if gp else line
        wfull=draw.textlength(line,font=f)
        x=(S-wfull)/2 if align=="center" else x0
        draw.text((x,y),body,font=f,fill=color)
        if gp:
            draw.text((x+draw.textlength(body,font=f),y),'.',font=f,fill=GOLD)
        y+=lh
    return y

def subline(draw, text, y, color=SMOKE, size=34, maxw=S-2*M-60, lh=1.5):
    f,lines,lhpx=fit(draw,text,SANS,size,maxw,400,lh=lh)
    for line in lines:
        w=draw.textlength(line,font=f)
        draw.text(((S-w)/2,y),line,font=f,fill=color)
        y+=lhpx
    return y

# ---------------- slide layouts ----------------
# launch-phase signatures (spec section 5): nav lockups only, no maker's mark.
NAV = Image.open(os.path.join(KIT, 'riley-nav-logo.png')).convert('RGBA')   # white word, for dark grounds
NAV_INK = Image.open(os.path.join(KIT, 'riley-nav-ink.png')).convert('RGBA')  # ink word, for light grounds
def nav_footer(img, w=176, ybottom=64):
    nv=NAV.resize((w,int(w*NAV.height/NAV.width)))
    img.paste(nv,((img.width-w)//2, img.height-nv.height-ybottom), nv)


def slide_hook(g, eb, head, sub=None, italic=False, headstart=104):
    img=ground(g); d=ImageDraw.Draw(img)
    eyebrow(d, eb)
    cy = 470 if sub else 510
    yend=headline(d, head, cy, start=headstart, italic=italic)
    if sub: subline(d, sub, max(yend+34, 640))
    nav_footer(img)
    return img

def slide_body(g, head, sub, eb=None):
    img=ground(g); d=ImageDraw.Draw(img)
    if eb: eyebrow(d, eb)
    else:
        r=9; d.ellipse([S//2-r,206-r,S//2+r,206+r],fill=GOLD)  # the sun-dot: one gold moment
    yend=headline(d, head, 450, start=82, maxh=420, gold_period=False)
    subline(d, sub, max(yend+40, 610))
    nav_footer(img)
    return img

def slide_list(g, eb, head, items):
    img=ground(g); d=ImageDraw.Draw(img)
    eyebrow(d, eb)
    f,lines,lh=fit(d,head,SERIF,72,S-2*M,180)
    y=250
    for i,line in enumerate(lines):
        last=(i==len(lines)-1); gp=last and line.endswith('.')
        body=line[:-1] if gp else line
        w=d.textlength(line,font=f)
        d.text(((S-w)/2,y),body,font=f,fill=PARCH)
        if gp: d.text(((S-w)/2+d.textlength(body,font=f),y),'.',font=f,fill=GOLD)
        y+=lh
    y+=54
    lh2=76
    block_h=len(items)*lh2
    y=max(y, (S-140-block_h)//2+40)
    maxw_item=S-(M+84)-M
    for it in items:
        size=37
        fi=ImageFont.truetype(SANS,size)
        while d.textlength(it,font=fi)>maxw_item and size>26:
            size-=1; fi=ImageFont.truetype(SANS,size)
        d.ellipse([M+40,y+20,M+52,y+32],fill=GOLD)
        d.text((M+84,y+ (37-size)//2),it,font=fi,fill=PARCH)
        y+=lh2
    nav_footer(img)
    return img

def slide_stat(g, eb, number, monoline, sub):
    img=ground(g); d=ImageDraw.Draw(img)
    eyebrow(d, eb)
    f=ImageFont.truetype(SERIF,270)
    w=d.textlength(number,font=f)
    d.text(((S-w)/2,300),number,font=f,fill=PARCH)
    fm=ImageFont.truetype(MONO,30); tr=10
    t=monoline.upper(); wm=tracked_width(d,t,fm,tr)
    draw_tracked(d,((S-wm)/2,650),t,fm,GOLD,tr)
    subline(d, sub, 740)
    nav_footer(img)
    return img

def slide_signoff(g, message, tagline=None, url="meetriley.us"):
    img=ground(g); d=ImageDraw.Draw(img)
    yend=headline(d, message, 360, start=76, maxh=340)
    if tagline: yend=subline(d, tagline, max(yend+34, 520))
    mk=NAV.resize((360,int(360*NAV.height/NAV.width)))
    img.paste(mk,((S-360)//2,672),mk)
    fm=ImageFont.truetype(MONO,30); tr=10
    t=url; wm=tracked_width(d,t,fm,tr)
    draw_tracked(d,((S-wm)/2,880),t,fm,GOLD,tr)
    return img

print("engine loaded OK")
