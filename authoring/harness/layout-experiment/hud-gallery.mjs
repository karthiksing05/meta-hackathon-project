import fs from 'node:fs';
import path from 'node:path';

const [out] = process.argv.slice(2);
const exists = file => fs.existsSync(path.join(out,file));
const read = file => JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
const escape = str => String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const variants = [
  ['before','Original HUD'], ['fixed','Contrast at original positions'],
  ['styled','Muse HUD, original art'], ['toned','Muse HUD, softened art'],
  ['adaptive','Muse HUD, repainted background'],
];
const games = ['moth','lunch','tide'].filter(id=>exists(id+'-draft.json')).map(id=>{
  const draft = read(id+'-draft.json');
  return `<section><h2>${escape(draft.manifest.title)}</h2>
  <div class="grid">${variants.map(([variant,label])=>{
    const name=id+'-hud-'+variant;
    if (!exists(name+'.png') || !exists(name+'.html')) return '';
    return `<article><h3>${label}</h3><div class="shot"><img src="${name}.png" alt="${label} gameplay screenshot"></div>
      <a href="${name}.html" aria-label="Play ${escape(draft.manifest.title)} with ${label}">Play</a></article>`;
  }).join('')}</div></section>`;
}).join('');
fs.writeFileSync(path.join(out,'hud.html'),`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Muse HUD comparison</title>
<style>
body{margin:0 auto;max-width:1140px;padding:28px 20px 64px;background:#17191d;color:#eee;font:16px/1.5 system-ui,sans-serif}
h1,h2,h3,p{margin:0}h1{font-size:2rem}h2{font-size:1.45rem}h3{font-size:.94rem;margin-bottom:8px}p{color:#c4c7cc;margin-top:4px}
section{margin-top:32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px;margin-top:10px}
article{border:1px solid #383b40;border-radius:12px;padding:10px;overflow:hidden}
.shot{overflow:hidden;border-radius:7px}img{width:128.205%;max-width:none;display:block}
a{color:#dce7ff}article a{display:inline-block;margin-top:10px;padding:5px 15px;border-radius:6px;background:#dce7ff;color:#141b2b;text-decoration:none;font-weight:600}
@media(max-width:720px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
<main><h1>Muse HUD comparison</h1><p><a href="index.html">Background experiment</a></p>${games}</main></html>`);
