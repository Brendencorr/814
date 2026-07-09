"""Riley multi-format engine — singles 1080x1350, stories 1080x1920, reels (frames).
Brand v2.1. Reuses the carousel system's fonts and rules, parametric canvas."""
import os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carousel_engine import (SERIF, SERIF_IT, SANS, MONO, INK, PARCH, GOLD, GOLD_LT, SMOKE,
                             wrap, fit, draw_tracked, tracked_width, NAV, NAV_INK,
                             GROUNDS_DIR, resolve_ground)

def _fmt_for(W, H):
    return {(1080, 1080): "square-1080x1080",
            (1080, 1350): "portrait-1080x1350",
            (1080, 1920): "story-1080x1920"}.get((W, H), "story-1080x1920")

def ground(kind, W, H, grain=True):
    # loads a pre-baked locked ground (grain already carried in the PNG); grain arg kept for signature compat
    name = resolve_ground(kind)
    return Image.open(os.path.join(GROUNDS_DIR, f"{name}--{_fmt_for(W, H)}.png")).convert("RGB")

def eyebrow(d, W, text, y, size=26, color=GOLD):
    f=ImageFont.truetype(MONO,size); t=text.upper(); tr=size*0.34
    w=tracked_width(d,t,f,tr)
    draw_tracked(d,((W-w)/2,y),t,f,color,tr)

def mono_line(d, W, text, y, size=24, color=SMOKE, tr=None):
    f=ImageFont.truetype(MONO,size); tr=tr if tr is not None else size*0.3
    w=tracked_width(d,text,f,tr)
    draw_tracked(d,((W-w)/2,y),text,f,color,tr)

def headline(d, W, text, cy, maxw, maxh, start, color=PARCH, gold_period=True, italic=False, lh=1.16):
    path=SERIF_IT if italic else SERIF
    f,lines,lhpx=fit(d,text,path,start,maxw,maxh,lh=lh)
    total=len(lines)*lhpx; y=cy-total//2
    for i,line in enumerate(lines):
        last=(i==len(lines)-1)
        gp=gold_period and last and line.endswith('.') and not line.endswith('..')
        body=line[:-1] if gp else line
        wfull=d.textlength(line,font=f)
        x=(W-wfull)/2
        d.text((x,y),body,font=f,fill=color)
        if gp: d.text((x+d.textlength(body,font=f),y),'.',font=f,fill=GOLD)
        y+=lhpx
    return y

def subline(d, W, text, y, maxw, size=34, color=SMOKE, lh=1.5):
    f,lines,lhpx=fit(d,text,SANS,size,maxw,500,lh=lh)
    for line in lines:
        w=d.textlength(line,font=f)
        d.text(((W-w)/2,y),line,font=f,fill=color)
        y+=lhpx
    return y

def nav_paste(img, w, ybottom):
    nv=NAV.resize((w,int(w*NAV.height/NAV.width)))
    img.paste(nv,((img.width-w)//2, img.height-nv.height-ybottom), nv)

def sun_dot(d, W, y, r=9):
    d.ellipse([W//2-r,y-r,W//2+r,y+r],fill=GOLD)

# ---------------- SINGLE POST 1080x1350 (4:5) ----------------
def single(g, eb, head, sub=None, italic=False):
    W,H=1080,1350
    img=ground(g,W,H); d=ImageDraw.Draw(img)
    if eb: eyebrow(d,W,eb,150)
    else: sun_dot(d,W,200)
    cy = 600 if sub else 640
    yend=headline(d,W,head,cy,maxw=W-208,maxh=620,start=100,italic=italic)
    if sub: subline(d,W,sub,max(yend+44,830),maxw=W-260)
    nav_paste(img,180,78)
    return img

# ---------------- STORY 1080x1920 ----------------
def story_quote(g, eb, head, sub=None, url=True):
    W,H=1080,1920
    img=ground(g,W,H); d=ImageDraw.Draw(img)
    if eb: eyebrow(d,W,eb,300)
    sun_dot(d,W,240 if not eb else 220) if not eb else None
    yend=headline(d,W,head,830,maxw=W-200,maxh=700,start=96)
    if sub: subline(d,W,sub,max(yend+50,1130),maxw=W-240,size=36)
    if url: mono_line(d,W,"MEETRILEY.US",H-360,size=28,color=GOLD,tr=10)
    nav_paste(img,190,118)
    return img

def story_poll(g, eb, head, opt_a, opt_b):
    """Question frame with a clear sticker zone (empty band) between options text."""
    W,H=1080,1920
    img=ground(g,W,H); d=ImageDraw.Draw(img)
    eyebrow(d,W,eb,300)
    headline(d,W,head,640,maxw=W-200,maxh=460,start=88)
    # sticker zone: subtle linen-toned rounded outline showing where the poll goes
    zx0,zy0,zx1,zy1 = 190, 980, W-190, 1230
    d.rounded_rectangle([zx0,zy0,zx1,zy1],radius=40,outline=(60,54,42),width=3)
    fo=ImageFont.truetype(SANS,34)
    for i,t in enumerate([opt_a,opt_b]):
        w=d.textlength(t,font=fo)
        d.text(((W-w)/2, 1030+i*90), t, font=fo, fill=SMOKE)
    mono_line(d,W,"POLL GOES HERE",1265,size=18,color=(90,84,70),tr=6)
    nav_paste(img,190,118)
    return img

def story_cta(g, head, sub, url="MEETRILEY.US"):
    W,H=1080,1920
    img=ground(g,W,H); d=ImageDraw.Draw(img)
    yend=headline(d,W,head,700,maxw=W-200,maxh=520,start=100)
    subline(d,W,sub,max(yend+50,1020),maxw=W-240,size=36)
    mk=NAV.resize((400,int(400*NAV.height/NAV.width))); img.paste(mk,((W-400)//2,1300),mk)
    mono_line(d,W,url,1560,size=30,color=GOLD,tr=11)
    return img

# ---------------- REEL / MOTION POST (frame generator) ----------------
def reel_frames(g, line1, line2, tail, seconds=8, fps=24):
    """Ground still · gold sun-dot breathing (5s cycle) · line1 fades 0-1.5s ·
       line2 fades 3-4.5s · tail (mono) fades 5.5-7s. Returns PIL frames."""
    W,H=1080,1920
    base=ground(g,W,H)  # pre-baked ground already carries a smooth grain
    # pre-render text layers (RGBA)
    def layer(drawfn):
        L=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(L); drawfn(d); return L
    L1=layer(lambda d: headline(d,W,line1,760,maxw=W-200,maxh=600,start=96))
    L2=layer(lambda d: subline(d,W,line2,1120,maxw=W-240,size=40,color=(190,184,168))) if line2 else None
    def _tail(d): mono_line(d,W,tail,1560,size=28,color=GOLD,tr=10)
    LT=layer(_tail)
    nv=NAV.resize((190,int(190*NAV.height/NAV.width)))
    LT.alpha_composite(nv,((W-190)//2, H-nv.height-118))
    frames=[]
    N=seconds*fps
    for i in range(N):
        t=i/fps
        f=base.copy()
        d=ImageDraw.Draw(f)
        # breathing sun-dot (5s ease-in-out): scale 1->1.06, opacity .92->1
        import math
        phase=(math.sin(2*math.pi*(t%5)/5 - math.pi/2)+1)/2   # 0..1 eased
        r=int(11*(1+0.35*phase))
        alpha=int(255*(0.80+0.20*phase))
        dot=Image.new('RGBA',(W,H),(0,0,0,0))
        dd=ImageDraw.Draw(dot)
        dd.ellipse([W//2-r,330-r,W//2+r,330+r],fill=GOLD+(alpha,))
        dot=dot.filter(ImageFilter.GaussianBlur(1))
        f=f.convert('RGBA'); f.alpha_composite(dot)
        def fade(t0,t1): return max(0.0,min(1.0,(t-t0)/(t1-t0)))
        a1=fade(0.4,1.9)
        if a1>0:
            l=L1.copy(); l.putalpha(l.split()[3].point(lambda p:int(p*a1))); f.alpha_composite(l)
        if L2 is not None:
            a2=fade(3.0,4.5)
            if a2>0:
                l=L2.copy(); l.putalpha(l.split()[3].point(lambda p:int(p*a2))); f.alpha_composite(l)
        a3=fade(5.5,7.0)
        if a3>0:
            l=LT.copy(); l.putalpha(l.split()[3].point(lambda p:int(p*a3))); f.alpha_composite(l)
        frames.append(f.convert('RGB'))
    return frames

print("multiformat engine loaded")
