// Render-and-measure. Builds one HTML page that composes each variant's art into a gameplay frame
// (with stand-ins for what the renderer draws: HUD, labels, track, button), screenshots it with
// headless Chrome, and measures padding, mass, edge contrast at play size and protected-zone
// busyness inside the page. No npm packages: Chrome does the rasterizing and the pixel math.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const COL = 420, HEAD = 44, FRAME_H = 640, STRIP = 150;

function pageHtml(variants, scene, roles) {
  const data = JSON.stringify({ variants, scene, roles }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#1d1d22;color:#eee;font:13px -apple-system,Helvetica,sans-serif;display:flex}
.col{width:${COL}px;padding:0 10px;box-sizing:border-box}
h2{font-size:13px;margin:0;height:${HEAD}px;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden}
h2 span{color:#999;font-weight:400}
canvas{display:block;border-radius:6px}
.strip{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;height:${STRIP}px;padding-top:8px}
.strip div{display:flex;flex-direction:column;align-items:center;gap:3px;color:#999;font-size:10px}
#out{display:none}
</style></head><body><pre id="out">pending</pre><script>
const D=${data};
const load=(svg)=>new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(Error('image failed'));i.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
const lum=(r,g,b)=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function regionLum(ctx,x,y,w,h){const d=ctx.getImageData(Math.max(0,x|0),Math.max(0,y|0),Math.max(1,w|0),Math.max(1,h|0)).data;let s=0;for(let i=0;i<d.length;i+=4)s+=lum(d[i],d[i+1],d[i+2]);return s/(d.length/4)}
function contrastPick(bgL,a,b){const la=lum(...hex(a)),lb=lum(...hex(b));const r=l=>(Math.max(l,bgL)+.05)/(Math.min(l,bgL)+.05);return r(la)>=r(lb)?a:b}
function hex(h){const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255]}
function stage(ctx,scene,ids){ // renderer stand-ins: like the real renderer, they pick ink or surface by contrast
  for(const s0 of scene.standins||[]){const s={...s0};ctx.save();
    if(s.type==='text'&&s.alt){const L=regionLum(ctx,s.align==='right'?s.x-120:s.x,s.y-(s.size||16),120,(s.size||16)+4);s.color=contrastPick(L,s.color,s.alt)}
    if(s.type==='pill'&&s.swap){const L=regionLum(ctx,s.x,s.y,s.w,s.h);if(contrastPick(L,s.fill,s.color)!==s.fill){[s.fill,s.color]=[s.color,s.fill]}}
    if(s.type==='line'){ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke()}
    if(s.type==='pill'){ctx.fillStyle=s.fill;ctx.beginPath();ctx.roundRect(s.x,s.y,s.w,s.h,s.h/2);ctx.fill();if(s.text){ctx.fillStyle=s.color;ctx.font='700 '+(s.size||16)+'px -apple-system,Helvetica';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.text,s.x+s.w/2,s.y+s.h/2+1)}}
    if(s.type==='text'){ctx.fillStyle=s.color;ctx.font='700 '+(s.size||16)+'px -apple-system,Helvetica';ctx.textAlign=s.align||'left';ctx.fillText(s.text,s.x,s.y)}
    if(s.type==='beam'){const g=ctx.createLinearGradient(0,s.y1,0,s.y2);g.addColorStop(0,s.color+'00');g.addColorStop(1,s.color+'88');ctx.fillStyle=g;ctx.fillRect(s.x-s.w/2,s.y1,s.w,s.y2-s.y1)}
    ctx.restore()}
}
(async()=>{
 const out={};
 for(const v of D.variants){
  const S=v.scene||D.scene;const m={assets:{},zones:[]};out[v.label]=m;
  const col=document.createElement('div');col.className='col';document.body.appendChild(col);
  col.innerHTML='<h2>'+v.label+' <span>'+(v.note||'')+'</span></h2>';
  const imgs={};
  for(const r of D.roles){if(v.art[r.id]){try{imgs[r.id]=await load(v.art[r.id])}catch(e){m.assets[r.id]={error:'does not render'}}}}
  // Per-sprite measurements at native size.
  for(const r of D.roles){if(r.kind==='backdrop'||!imgs[r.id])continue;
    const c=canvas(r.width,r.height),x=c.getContext('2d');x.drawImage(imgs[r.id],0,0,r.width,r.height);
    const d=x.getImageData(0,0,r.width,r.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1,n=0;
    for(let yy=0;yy<r.height;yy++)for(let xx=0;xx<r.width;xx++){if(d[(yy*r.width+xx)*4+3]>40){n++;if(xx<x0)x0=xx;if(yy<y0)y0=yy;if(xx>x1)x1=xx;if(yy>y1)y1=yy}}
    m.assets[r.id]={bbox:n?{x0,y0,x1:x1+1,y1:y1+1}:null,coverage:n?n/((x1-x0+1)*(y1-y0+1)):0};
  }
  // Backdrop alone, for zones and contrast.
  const W=S.width,H=S.height,bg=canvas(W,H),bx=bg.getContext('2d');
  if(imgs.backdrop)bx.drawImage(imgs.backdrop,0,0,W,H);else{bx.fillStyle='#888';bx.fillRect(0,0,W,H)}
  const bd=bx.getImageData(0,0,W,H).data;
  const L=new Float32Array(W*H);for(let i=0;i<W*H;i++)L[i]=lum(bd[i*4],bd[i*4+1],bd[i*4+2]);
  // Busyness on 3 px blocks, so fine regular texture (grain, scanlines) doesn't count as clutter.
  const B=3,bw=Math.floor(W/B),bh=Math.floor(H/B),LB=new Float32Array(bw*bh);
  for(let by=0;by<bh;by++)for(let bx2=0;bx2<bw;bx2++){let s=0;for(let yy=0;yy<B;yy++)for(let xx=0;xx<B;xx++)s+=L[(by*B+yy)*W+bx2*B+xx];LB[by*bw+bx2]=s/(B*B)}
  for(const z of S.zones||[]){let busy=0,n=0;
    for(let by=Math.ceil(z.y/B);by<Math.floor((z.y+z.h)/B)-1;by++)for(let bx2=Math.ceil(z.x/B);bx2<Math.floor((z.x+z.w)/B)-1;bx2++){const i=by*bw+bx2;const g=Math.abs(LB[i]-LB[i+1])+Math.abs(LB[i]-LB[i+bw]);if(g>.05)busy++;n++}
    const vals=[];for(let by=Math.ceil(z.y/B);by<Math.floor((z.y+z.h)/B);by++)for(let bx2=Math.ceil(z.x/B);bx2<Math.floor((z.x+z.w)/B);bx2++)vals.push(LB[by*bw+bx2]);vals.sort((a,b)=>a-b);
    const q=f=>vals[Math.min(vals.length-1,Math.floor(f*vals.length))];const spread=(q(.97)+.05)/(q(.03)+.05);
    m.zones.push({...z,busy:busy/n,spread});}
  // Contrast: sprite boundary vs the backdrop just outside it, at each placement, at play size.
  for(const p of S.place||[]){const r=D.roles.find(q=>q.id===p.role);if(!imgs[r.id])continue;
    const w=Math.round(p.w),h=Math.round(p.w*r.height/r.width),sx=Math.round(p.x-w/2),sy=Math.round(p.y-h/2);
    const c=canvas(w,h),x=c.getContext('2d');x.drawImage(imgs[r.id],0,0,w,h);const d=x.getImageData(0,0,w,h).data;
    const A=(xx,yy)=>xx<0||yy<0||xx>=w||yy>=h?0:d[(yy*w+xx)*4+3];
    let inL=0,inN=0,outL=0,outN=0,edgeL=0,edgeN=0;
    for(let yy=-2;yy<h+2;yy++)for(let xx=-2;xx<w+2;xx++){const a=A(xx,yy);let edge=false;for(const[dx,dy]of[[2,0],[-2,0],[0,2],[0,-2]])if((A(xx+dx,yy+dy)>128)!==(a>128))edge=true;if(!edge)continue;
      const X=sx+xx,Y=sy+yy;if(X<0||Y<0||X>=W||Y>=H)continue;
      if(a>128){const i=(yy*w+xx)*4;edgeL+=lum(d[i],d[i+1],d[i+2]);edgeN++}else{outL+=L[Y*W+X];outN++}}
    // Inside: the sprite's whole opaque body, so a dark outline on a dark scene doesn't hide a bright car.
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const i=(yy*w+xx)*4;if(d[i+3]>128){inL+=lum(d[i],d[i+1],d[i+2]);inN++}}
    if(inN&&outN){const b=outL/outN,cr=(a)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      // Separation comes from either the edge (an outline or glow) or the body as a whole.
      const ratio=Math.max(cr(inL/inN),edgeN?cr(edgeL/edgeN):0);
      const cur=m.assets[r.id]||(m.assets[r.id]={});cur.contrast=Math.min(cur.contrast??99,ratio)}}
  // The frame a player would see.
  const f=canvas(W,H),fx=f.getContext('2d');fx.drawImage(bg,0,0);stage(fx,S,imgs);
  for(const p of S.place||[]){const r=D.roles.find(q=>q.id===p.role);if(!imgs[r.id])continue;const w=p.w,h=p.w*r.height/r.width;fx.globalAlpha=p.alpha??1;fx.drawImage(imgs[r.id],p.x-w/2,p.y-h/2,w,h);fx.globalAlpha=1}
  if(imgs.foreground)fx.drawImage(imgs.foreground,0,0,W,H);
  if(S.showZones)for(const z of S.zones||[]){fx.strokeStyle='rgba(255,0,255,.55)';fx.setLineDash([4,3]);fx.strokeRect(z.x+.5,z.y+.5,z.w,z.h)}
  col.appendChild(f);
  // Sprites at play size and 2x.
  const strip=document.createElement('div');strip.className='strip';col.appendChild(strip);
  for(const r of D.roles){if(r.kind==='backdrop'||r.id==='foreground'||!imgs[r.id])continue;
    for(const k of[1,2]){const w=Math.round((r.play||r.width)*k),h=Math.round(w*r.height/r.width);const c=canvas(w,h);c.getContext('2d').drawImage(imgs[r.id],0,0,w,h);
      const box=document.createElement('div');box.appendChild(c);box.append(r.id+' '+(k===1?'play':'2×'));strip.appendChild(box)}}
 }
 document.getElementById('out').textContent=JSON.stringify(out);
})().catch(e=>{document.getElementById('out').textContent='ERROR '+e.message});
</script></body></html>`;
}

/**
 * variants: [{label, note?, art: {roleId: compiled svg}}]. Writes <out>/<name>.html and .png.
 * Returns {png, metrics: {label: {...}}}.
 */
export function render(variants, scene, roles, outDir, name = 'sheet') {
  fs.mkdirSync(outDir, { recursive: true });
  const html = path.resolve(outDir, name + '.html'), png = path.resolve(outDir, name + '.png');
  fs.writeFileSync(html, pageHtml(variants, scene, roles));
  const size = `${variants.length * COL},${HEAD + FRAME_H + STRIP + 20}`;
  const common = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--virtual-time-budget=20000', `--window-size=${size}`, '--force-device-scale-factor=1'];
  const dom = execFileSync(CHROME, [...common, '--dump-dom', 'file://' + html], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const raw = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)?.[1] ?? 'missing';
  const text = raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (!text.startsWith('{')) throw Error('render failed: ' + text.slice(0, 200));
  execFileSync(CHROME, [...common, `--screenshot=${png}`, 'file://' + html], { stdio: 'ignore' });
  return { png, html, metrics: JSON.parse(text) };
}
