// The blind judging page shared by the experiments: pairs of frames, A/tie/B, nothing that
// reveals which arm is which. Picks are kept in localStorage and shown as JSON at the end.

export function judgePage(items) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Art judge</title><style>
:root{--bg:#f6f5f2;--fg:#1d1d22;--muted:#6b6b72;--card:#fff;--line:#dedcd6;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#ececf0;--muted:#9a9aa3;--card:#232328;--line:#34343a;--accent:#7c95ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px -apple-system,Helvetica,sans-serif}
main{max-width:1180px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
h1{font-size:18px;margin:0}.muted{color:var(--muted)}
.style{font-size:20px;font-weight:600;margin:14px 0 4px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
figure{margin:0;background:var(--card);border:2px solid var(--line);border-radius:10px;padding:8px;cursor:pointer}
figure.sel{border-color:var(--accent)}figure img{width:100%;display:block;border-radius:6px}
figcaption{text-align:center;font-weight:600;padding-top:6px}
.bar{display:flex;gap:8px;justify-content:center;margin:14px 0;flex-wrap:wrap}
button{font:inherit;padding:9px 16px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
input{font:inherit;width:100%;box-sizing:border-box;padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
#done{display:none;margin-top:20px}textarea{width:100%;height:140px;font:12px ui-monospace,monospace;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:8px}
@media (max-width:700px){.pair{grid-template-columns:1fr}}
</style></head><body><main>
<header><h1>Which frame has better art?</h1><span class="muted" id="count"></span></header>
<p class="muted">Which is the better game art for what was asked for? Consider: does it look like the requested style and theme, is it one coherent set, do the car and lantern read at their size and stand out, are the areas behind the HUD, track and button calm, is anything clumsy. Keys: 1 = A, 2 = tie, 3 = B, ← → to move.</p>
<div class="style" id="style"></div>
<div class="pair"><figure id="fa"><img id="ia"><figcaption>A</figcaption></figure><figure id="fb"><img id="ib"><figcaption>B</figcaption></figure></div>
<div class="bar"><button data-p="A">A is better</button><button data-p="tie">About the same</button><button data-p="B">B is better</button></div>
<input id="note" placeholder="Optional: why (one line)">
<div class="bar"><button id="prev">← Back</button><button id="next">Next →</button></div>
<div id="done"><p><b>All pairs judged.</b> Tell Claude you're done; it reads your answers from this page. A copy is below.</p><textarea id="dump" readonly></textarea></div>
</main><script>
const ITEMS=${JSON.stringify(items)};
let i=0;window.results={};
const STORE='art-judge-'+${JSON.stringify(Date.now())};
try{Object.assign(window.results,JSON.parse(localStorage.getItem(STORE)||'{}'))}catch(e){}
const $=id=>document.getElementById(id);
function persist(){try{localStorage.setItem(STORE,JSON.stringify(window.results))}catch(e){}}
function show(){const it=ITEMS[i],r=window.results[it.id]||{};
 $('style').textContent='“'+it.style+'”';$('ia').src=it.a;$('ib').src=it.b;$('note').value=r.note||'';
 document.querySelectorAll('[data-p]').forEach(b=>b.classList.toggle('on',b.dataset.p===r.pick));
 $('fa').classList.toggle('sel',r.pick==='A');$('fb').classList.toggle('sel',r.pick==='B');
 const n=Object.keys(window.results).length;$('count').textContent=(i+1)+' of '+ITEMS.length+' · '+n+' judged';
 const all=ITEMS.every(x=>window.results[x.id]);$('done').style.display=all?'block':'none';if(all)$('dump').value=JSON.stringify(window.results);}
function pick(p){const it=ITEMS[i];window.results[it.id]={pick:p,note:$('note').value.trim()};persist();if(i<ITEMS.length-1)i++;show();}
document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>pick(b.dataset.p));
$('fa').onclick=()=>pick('A');$('fb').onclick=()=>pick('B');
$('note').oninput=()=>{const it=ITEMS[i];if(window.results[it.id]){window.results[it.id].note=$('note').value.trim();persist()}};
$('prev').onclick=()=>{if(i>0)i--;show()};$('next').onclick=()=>{if(i<ITEMS.length-1)i++;show()};
document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.key==='1')pick('A');if(e.key==='2')pick('tie');if(e.key==='3')pick('B');if(e.key==='ArrowLeft')$('prev').click();if(e.key==='ArrowRight')$('next').click();});
show();
</script></body></html>`;
}
