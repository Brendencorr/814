#!/usr/bin/env python3
"""Render THE hero logo (the Meet Riley card: centered glowing orb + "8:14." at the bottom,
verbatim from home.html .riley-visual) to PNG at any size, and POST each back to disk.
No SVG->PNG tool on this box, so we draw it on a browser <canvas> (fonts load normally)."""
import http.server, socketserver, os
# repo root (two levels up from assets/hero-logo/) — writes icon-512/192 + apple-touch-icon there
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

PAGE = r"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>body{background:#111;color:#ddd;font-family:sans-serif;padding:20px}</style>
</head><body><div id="log">generating…</div>
<script>
async function draw(S){
  await document.fonts.load('400 ' + Math.round(S*0.074) + 'px "DM Serif Display"');
  await document.fonts.ready;
  const c=document.createElement('canvas');c.width=S;c.height=S;const x=c.getContext('2d');
  // card bg: --ink2 with a warm radial wash toward top-left (matches .riley-visual bg)
  x.fillStyle='#141210';x.fillRect(0,0,S,S);
  let bg=x.createRadialGradient(S*0.38,S*0.32,0, S*0.38,S*0.32,S*0.62);
  bg.addColorStop(0,'rgba(201,168,76,0.22)');bg.addColorStop(1,'rgba(201,168,76,0)');
  x.fillStyle=bg;x.fillRect(0,0,S,S);
  // orb (150px in a 460 card => r 0.163S), CENTERED
  const cx=S*0.5, cy=S*0.5, r=S*0.163;
  // soft glow around the orb (box-shadow 0 0 80px rgba(201,168,76,0.4))
  let halo=x.createRadialGradient(cx,cy,r*0.55, cx,cy,r+S*0.174);
  halo.addColorStop(0,'rgba(201,168,76,0.40)');halo.addColorStop(1,'rgba(201,168,76,0)');
  x.fillStyle=halo;x.fillRect(0,0,S,S);
  // the orb itself (radial highlight at 40% 35%)
  let sun=x.createRadialGradient(cx-r*0.20,cy-r*0.30,r*0.05, cx,cy,r);
  sun.addColorStop(0,'#e8d5a3');sun.addColorStop(0.55,'#c9a84c');sun.addColorStop(1,'#a8842f');
  x.fillStyle=sun;x.beginPath();x.arc(cx,cy,r,0,7);x.fill();
  // "8:14." at the bottom (bottom:24px, 34px), centered
  x.textBaseline='alphabetic';x.textAlign='left';
  x.font='400 ' + Math.round(S*0.074) + 'px "DM Serif Display", serif';
  const num='8:14', dot='.';
  const wn=x.measureText(num).width, wd=x.measureText(dot).width, tot=wn+wd;
  const sx=cx-tot/2, ty=S*0.925;
  x.fillStyle='#fff';x.fillText(num,sx,ty);
  x.fillStyle='#c9a84c';x.fillText(dot,sx+wn,ty);
  return new Promise(function(res){c.toBlob(function(b){res(b);},'image/png');});
}
async function save(name,S){ const b=await draw(S); await fetch('/save/'+name,{method:'POST',body:b}); }
(async function(){
  try{
    await save('icon-512.png',512);
    await save('icon-192.png',192);
    await save('apple-touch-icon.png',180);
    await save('assets__hero-logo__hero-logo.png',512);
    document.getElementById('log').textContent='DONE';
  }catch(e){ document.getElementById('log').textContent='ERR '+e; }
})();
</script></body></html>"""

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers()
        self.wfile.write(PAGE.encode('utf-8'))
    def do_POST(self):
        if self.path.startswith('/save/'):
            name = os.path.basename(self.path).replace('__', os.sep)
            dest = os.path.join(ROOT, name)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            n = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(n)
            with open(dest, 'wb') as f:
                f.write(data)
            self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", 8815), H) as httpd:
    httpd.serve_forever()
