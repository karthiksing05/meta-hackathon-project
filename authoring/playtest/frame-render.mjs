// Draws engine frames in headless Chrome with the engine's own renderer (engine/web/render.js), so
// what we measure is what a player sees. One Chrome launch per call. For each frame it returns:
//   - text measures: the real width of every text op's lines in the browser's font;
//   - backdrop samples: the pixels under every text op's ink box, drawn with every text op left out
//     (so contrast is measured against the art and shapes actually behind the words);
//   - optionally a PNG of the full frame (at `scale`), for contact sheets and the vision critique.
// No npm packages: Chrome rasterizes, measures and samples inside the page (`--dump-dom`).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const here = dirname(fileURLToPath(import.meta.url));

export function chromeAvailable() { return existsSync(CHROME); }

function rendererSource() {
  const candidates = [process.env.MG_ENGINE_DIR && join(process.env.MG_ENGINE_DIR, 'web/render.js'), resolve(here, '../../engine/web/render.js')].filter(Boolean);
  const file = candidates.find((c) => existsSync(c));
  if (!file) throw new Error('engine/web/render.js not found');
  // A classic script: drop the module import (rgbaToCss is defined in the page) and the exports.
  return readFileSync(file, 'utf8').replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, '');
}

function pageHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><pre id="out">pending</pre><script>
function rgbaToCss(c){c=c>>>0;const a=(c&255)/255;return 'rgba('+(c>>>24)+','+((c>>>16)&255)+','+((c>>>8)&255)+','+(+a.toFixed(3))+')'}
${rendererSource()}
const D=${json};
function u32(s){if(s==null||s===0)return 0;if(typeof s==='number')return s>>>0;let h=String(s).replace('#','');
 if(h.length===3)h=h.split('').map(c=>c+c).join('');if(h.length===6)h+='ff';if(h.length!==8)return 0;return parseInt(h,16)>>>0}
function decode(f){return{...f,background:u32(f.background),shake:0,ops:f.ops.map(o=>{const p={...o};
 for(const k of['fill','stroke','color'])if(k in p)p[k]=u32(p[k]);if(p.op==='poly'&&Array.isArray(p.points))p.points=p.points.flat();
 if(p.op==='text'&&p.line_height==null)p.line_height=p.size*1.25;return p})}}
async function loadAssets(list){const images=[];await Promise.all(list.map(a=>new Promise(ok=>{if(a.kind!=='image'){ok();return}
 let src=a.src;const frames=a.frames||1,cols=a.cols||frames;
 if(a.svg){let svg=a.src;if(!/xmlns=/.test(svg.slice(0,400)))svg=svg.replace(/^<svg/,'<svg xmlns="http://www.w3.org/2000/svg"');
  if(!/^<svg[^>]*\\swidth=/.test(svg)){const rows=Math.ceil(frames/cols);svg=svg.replace(/^<svg/,'<svg width="'+a.w*cols+'" height="'+a.h*rows+'"')}
  src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}
 const img=new Image();const e={img,ok:false,frames,cols};images[a.id]=e;img.onload=()=>{e.ok=!!img.naturalWidth;ok()};img.onerror=()=>ok();img.src=src})));
 return{images}}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function inkBox(o,widths){const lines=o.text.split('\\n');const lh=o.line_height||o.size*1.25;const w=Math.max(0,...widths);
 const blockH=lh*lines.length;const x0=o.align==='left'?o.x:o.align==='right'?o.x+o.w-w:o.x+o.w/2-w/2;
 const y0=o.valign==='top'?o.y:o.valign==='bottom'?o.y+o.h-blockH:o.y+(o.h-blockH)/2;const pad=(lh-o.size)/2;
 let b={x0,y0:y0+pad,x1:x0+w,y1:y0+blockH-pad};const s=o.scale??1;if(s!==1){const cx=o.x+o.w/2,cy=o.y+o.h/2;
 b={x0:cx+(b.x0-cx)*s,y0:cy+(b.y0-cy)*s,x1:cx+(b.x1-cx)*s,y1:cy+(b.y1-cy)*s}}return b}
(async()=>{const assets=await loadAssets(D.assets);const out=[];
 const mc=canvas(8,8).getContext('2d');
 for(const F of D.frames){const f=decode(F);const W=f.width,H=f.height;const r={texts:[]};
  // Backdrop: every op except text.
  const bc=canvas(W,H),bx=bc.getContext('2d',{willReadFrequently:true});
  drawFrame(bx,{...f,ops:f.ops.filter(o=>o.op!=='text')},assets,{noShake:true});
  const px=bx.getImageData(0,0,W,H).data;
  f.ops.forEach((o,i)=>{if(o.op!=='text'||!o.text)return;mc.font=fontFor(o.weight,o.size,o.font);
   const widths=o.text.split('\\n').map(l=>mc.measureText(l).width);const b=inkBox(o,widths);const samples=[];
   const nx=8,ny=3;for(let a=0;a<ny;a++)for(let c=0;c<nx;c++){const x=Math.floor(b.x0+(c+0.5)*(b.x1-b.x0)/nx),y=Math.floor(b.y0+(a+0.5)*(b.y1-b.y0)/ny);
    if(x<0||y<0||x>=W||y>=H)continue;const k=(y*W+x)*4;samples.push([px[k],px[k+1],px[k+2]])}
   r.texts.push({i,widths,samples})});
  if(F.png){const k=D.scale||2;const c=canvas(W*k,H*k);drawFrame(c.getContext('2d'),f,assets,{k,noShake:true});r.png=c.toDataURL('image/png')}
  out.push(r)}
 document.getElementById('out').textContent=JSON.stringify(out)})().catch(e=>{document.getElementById('out').textContent='ERROR '+e.message});
</script></body></html>`;
}

/**
 * frames: [{width, height, background, ops (frameJSON ops), png?: bool}]; assets: game.assets() list.
 * Returns [{texts: [{i, widths, samples: [[r,g,b]...]}], png?: Buffer}] in frame order.
 */
export function renderFrames(frames, assets, { scale = 2, budgetMs = 15000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mg-frames-'));
  try {
    const html = join(dir, 'frames.html');
    writeFileSync(html, pageHtml({ frames, assets: assets.filter((a) => a.kind === 'image'), scale }));
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', `--user-data-dir=${join(dir, 'profile')}`, `--virtual-time-budget=${budgetMs}`, '--dump-dom', 'file://' + html];
    let dom;
    try { dom = execFileSync(CHROME, args, { encoding: 'utf8', maxBuffer: 512 << 20, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }); }
    catch (e) { throw new Error(`chrome exited (${e.code ?? e.signal ?? e.status}): ${String(e.stderr ?? '').trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`); }
    const raw = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)?.[1] ?? 'missing';
    const text = raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    if (!text.startsWith('[')) throw new Error('frame render failed: ' + text.slice(0, 200));
    return JSON.parse(text).map((r) => (r.png ? { ...r, png: Buffer.from(r.png.split(',')[1], 'base64') } : r));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
