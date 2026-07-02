#!/usr/bin/env python3
"""Tiny same-origin server: serves a canvas page that draws the hero-logo icon
(clean sun + 8:14.) at 512/192/180 and POSTs each PNG back here to write to disk."""
import http.server, socketserver, os
# repo root (two levels up from assets/hero-logo/) — writes icon-512/192 + apple-touch-icon there
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

PAGE = r"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>body{background:#111;color:#ddd;font-family:sans-serif;padding:20px}</style>
</head><body><div id="log">generating…</div>
<script>
async function draw(S){
  await document.fonts.load('400 ' + Math.round(S*0.20) + 'px "DM Serif Display"');
  await document.fonts.ready;
  const c=document.createElement('canvas');c.width=S;c.height=S;const x=c.getContext('2d');
  // dark background with a warm radial wash
  let bg=x.createRadialGradient(S*0.5,S*0.30,0,S*0.5,S*0.30,S*0.98);
  bg.addColorStop(0,'#17130d');bg.addColorStop(0.55,'#0a0807');bg.addColorStop(1,'#040302');
  x.fillStyle=bg;x.fillRect(0,0,S,S);
  let gl=x.createRadialGradient(S*0.5,S*0.36,0,S*0.5,S*0.36,S*0.52);
  gl.addColorStop(0,'rgba(201,168,76,0.20)');gl.addColorStop(1,'rgba(201,168,76,0)');
  x.fillStyle=gl;x.fillRect(0,0,S,S);
  // sun — gold radial orb with a soft glow (no horizon line)
  const cx=S*0.5, cy=S*0.365, r=S*0.158;
  x.save();x.shadowColor='rgba(201,168,76,0.55)';x.shadowBlur=S*0.10;
  let sun=x.createRadialGradient(cx-r*0.28,cy-r*0.30,r*0.08,cx,cy,r);
  sun.addColorStop(0,'#f2e4bc');sun.addColorStop(0.55,'#c9a84c');sun.addColorStop(1,'#a8842f');
  x.fillStyle=sun;x.beginPath();x.arc(cx,cy,r,0,7);x.fill();x.restore();
  // "8:14." in DM Serif — white number, gold period
  x.textBaseline='alphabetic';
  x.font='400 ' + Math.round(S*0.205) + 'px "DM Serif Display", serif';
  const num='8:14', dot='.';
  const wn=x.measureText(num).width, wd=x.measureText(dot).width, tot=wn+wd;
  const sx=cx-tot/2, ty=S*0.74;
  x.textAlign='left';
  x.fillStyle='#f5f0e8';x.fillText(num,sx,ty);
  x.fillStyle='#c9a84c';x.fillText(dot,sx+wn,ty);
  return new Promise(function(res){c.toBlob(function(b){res(b);},'image/png');});
}
async function save(name,S){ const b=await draw(S); await fetch('/save/'+name,{method:'POST',body:b}); }
(async function(){
  try{
    await save('icon-512.png',512);
    await save('icon-192.png',192);
    await save('apple-touch-icon.png',180);
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
            name = os.path.basename(self.path)
            n = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(n)
            with open(os.path.join(ROOT, name), 'wb') as f:
                f.write(data)
            self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", 8815), H) as httpd:
    httpd.serve_forever()
