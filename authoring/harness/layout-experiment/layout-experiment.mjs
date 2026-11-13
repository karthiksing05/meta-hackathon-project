import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { applyHud, hudOptions } from './hud.mjs';
import { extractObject } from '../../../backend/generator/src/muse.mjs';

const [repo, envPath, out, phase = 'all'] = process.argv.slice(2);
const { loadStudio } = await import(path.join(repo, 'backend/generator/src/studio.mjs'));
const studio = loadStudio(); // the engine and Studio bundles from the app's folders
const runtimeDir = path.join(repo, 'FacebookClone/Bubbles/Runtime/web');
const context = vm.createContext({ TextEncoder, TextDecoder, console });
vm.runInContext(fs.readFileSync(path.join(runtimeDir,'bubble-kit-microgame-engine.js'),'utf8'),context);
const engine = context.MicrogameEngine.getEngine();
const save = (name, value) => fs.writeFileSync(path.join(out, name), value);
const read = (name) => fs.readFileSync(path.join(out, name));
const json = (name, value) => save(name, JSON.stringify(value, null, 2));
const exists = (name) => fs.existsSync(path.join(out, name));
const player = path.join(repo, 'backend/internal/staticsrv/player');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scripts = fs.readFileSync(path.join(player, 'index.html'), 'utf8').match(/<script src="runtime\/[^"]+"><\/script>/g).join('\n');
const common = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  '--window-size=500,844', '--force-device-scale-factor=1', '--virtual-time-budget=5000'];
const esc = (str) => String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const safeJSON = (obj) => JSON.stringify(obj).replaceAll('<', '\\u003c');

function page(manifest, mode) {
  const hud = manifest.id.includes('-hud-') ? JSON.parse(manifest.content.game_json).presentation.tokens : null;
  const card = manifest.id.includes('-hud-') && !manifest.id.endsWith('-hud-before') && hud?.hud_panel
    ? `#bubble-root .bubble-card.intro{background:${hud.hud_panel};color:${hud.hud_ink}}#bubble-root .intro .card-rule{color:${hud.hud_ink}}` : '';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(manifest.title)}</title>
<link rel="stylesheet" href="runtime/bubble-glow.css">
<style>body{margin:0;background:#191926}#bubble-root{position:relative;width:390px;height:844px;overflow:hidden}${card}</style>
<div id="bubble-root" class="palette-lilac-haze"><canvas id="bubble-canvas"></canvas></div>
${scripts}
<script>
const config = {manifest:${safeJSON(manifest)},mode:${safeJSON(mode)},player:{name:'Tester',best:null},muted:true,
 reduced_motion:true,insets:{top:0,bottom:0,left:0,right:0}};
const valid = Bubble.validate(config.manifest);
const prep = JSON.parse(BubbleHost.prepare(config));
const act = prep.ok ? JSON.parse(BubbleHost.activate(prep.key,JSON.stringify(config))) : {};
document.documentElement.dataset.ok = valid.ok && prep.ok && act.ok;
if (document.documentElement.dataset.ok !== 'true') document.body.textContent = JSON.stringify({valid,prep,act});
</script>`;
}
function capture(id, manifest) {
  save(id + '-poster.html', page(manifest, 'poster'));
  const url = pathToFileURL(path.join(out, id + '-poster.html')).href;
  const args = () => [...common, '--user-data-dir=' + fs.mkdtempSync('/tmp/muse-chrome-'), url];
  const dom = execFileSync(chrome, ['--dump-dom', ...args()], {encoding:'utf8',maxBuffer:8 << 20,stdio:['ignore','pipe','ignore']});
  if (!dom.includes('data-ok="true"')) throw Error(id + ' runtime rejected manifest');
  execFileSync(chrome, ['--screenshot=' + path.join(out, id + '.png'), ...args()], {stdio:'ignore'});
  save(id + '.html', page(manifest, 'play'));
}
function build(authoring, original, id) {
  const exp = studio.expand(JSON.stringify(authoring));
  if (!exp.ok) throw Error(id + ': ' + JSON.stringify(exp.diagnostics));
  return studio.wrap({id, seed:original.seed, brief:original.brief,
    game_json:exp.game_json, authoring_json:exp.authoring_json});
}
function geometry(sprite) {
  const svg = Array.isArray(sprite.svg) ? sprite.svg[0] : sprite.svg;
  const m = /viewBox=['"][-.\d]+\s+[-.\d]+\s+([.\d]+)\s+([.\d]+)/.exec(svg ?? '');
  const [vw,vh] = m ? [Number(m[1]),Number(m[2])] : [64,64];
  return { w:sprite.w ?? Math.round(vw*64/Math.max(vw,vh)),h:sprite.h ?? Math.round(vh*64/Math.max(vw,vh)) };
}
const palette = {bg:'#262830',surface:'#333743',primary:'#c0c8d4',secondary:'#788e9e',
  accent:'#f8d48b',ink:'#ffffff',danger:'#f5a7a5'};
const colors = {avatar:'#a0b3ff',pickup:'#ffce72',life:'#e5d4fe'};
function placeholders(a) {
  const sprites = Object.fromEntries(Object.entries(a.art?.sprites ?? {}).map(([role,sprite]) => {
    const {w,h} = geometry(sprite);
    const col = colors[role] ?? palette.danger;
    const svg = `<svg viewBox="0 0 ${w} ${h}"><rect x="1" y="1" width="${w-2}" height="${h-2}" rx="4" fill="${col}"/></svg>`;
    const frames = Array.isArray(sprite.svg) ? sprite.svg.length : sprite.frames ?? 1;
    return [role,{w,h,svg:frames > 1 ? Array(frames).fill(svg) : svg,
      ...(sprite.fps !== undefined ? {fps:sprite.fps} : {}), ...(sprite.color ? {color:sprite.color} : {})}];
  }));
  return {...a,art:{palette,sprites}};
}
const ff = (args, opts={}) => execFileSync('ffmpeg', ['-v','error','-nostdin','-y',...args], {stdio:['ignore','pipe','pipe'], ...opts});

function compressBackdrop(file, w, h, name) {
  const target = path.join(out,name);
  for (const q of [82,68,54,40]) {
    ff(['-i',file,'-vf',`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
      '-frames:v','1','-c:v','libwebp','-quality',String(q),target]);
    if (fs.statSync(target).size < 46 * 1024) return fs.readFileSync(target);
  }
  throw Error(name + ' exceeds backdrop budget');
}
function cutSprite(file, sprite, name) {
  const side = 384;
  const pixels = ff(['-i',file,'-vf',`scale=${side}:${side}:force_original_aspect_ratio=decrease,pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:0x00FF00`,
    '-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1']);
  const bg = [...pixels.subarray(0,3)];
  let left=side, right=-1, top=side, bottom=-1, edgePixels=0;
  for(let y=0;y<side;y++) for(let x=0;x<side;x++) {
    const i = (y*side+x)*4;
    const [r,g,b] = pixels.subarray(i,i+3);
    const dist = Math.hypot(r-bg[0],g-bg[1],b-bg[2]);
    const green = g - Math.max(r,b);
    const alpha = green > 45 ? 0 : Math.round(255*Math.min(1,Math.max(0,(dist-45)/70)));
    pixels[i+3]=alpha;
    if(alpha) pixels[i+1]=Math.min(g,Math.max(r,b)+Math.round(255*alpha/255));
    if(alpha>20) {
      left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y);
      if(x===0||y===0||x===side-1||y===side-1) edgePixels++;
    }
  }
  if(right-left<12 || bottom-top<12 || edgePixels>8) throw Error(name + ' cannot be cleanly keyed');
  const {w,h}=geometry(sprite);
  const k=128/Math.max(w,h), tw=Math.round(w*k/2)*2, th=Math.round(h*k/2)*2;
  const target=path.join(out,name);
  ff(['-f','rawvideo','-pix_fmt','rgba','-s',`${side}x${side}`,'-i','pipe:0','-vf',
    `crop=${right-left+1}:${bottom-top+1}:${left}:${top},scale=${tw-4}:${th-4}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
    '-frames:v','1','-c:v','libwebp','-quality','82',target],{input:pixels,stdio:['pipe','pipe','pipe']});
  return {image:'data:image/webp;base64,'+fs.readFileSync(target).toString('base64'),w,h,...(sprite.color?{color:sprite.color}:{})};
}
const theme = {
  moth: {roles:{avatar:'amber lantern',pickup:'pale gold moth',raindrop:'blue raindrop'},
    style:'A layered cut-paper shadowbox at night. Use a subdued indigo, charcoal and warm cream palette, with visible cut paper edges.'},
  lunch: {roles:{avatar:'empty lunch tray',pickup:'steamed dumpling',chili:'red chili pepper'},
    style:'A warm illustrated lunch counter, with glazed ceramics, cream tiles and the colors of chili oil and steamed dough. Clean shapes and a tactile matte finish.'},
};

const apiKey = process.env.MUSE_API_KEY || (fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8') : '').match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
async function paint(id, prompt, size, guide) {
  const name=id+'-source.png';
  if(exists(name)) return path.join(out,name);
  save(id+'-prompt.txt',prompt);
  const start=Date.now();
  const content=[{type:'input_text',text:prompt}];
  if(guide) content.push({type:'input_image',image_url:'data:image/png;base64,'+read(guide).toString('base64')});
  if (!apiKey) throw Error('Missing Muse key');
  const result=await fetch('https://api.meta.ai/v1/responses',{
    method:'POST',signal:AbortSignal.timeout(240000),
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
    body:JSON.stringify({model:'muse-image-1.0',store:false,input:[{role:'user',content}],
      tools:[{type:'image_generation',enable_image_search:false,enable_web_search:false,
        enable_shell:false,reasoning_strength:'low',size,output_format:'png'}]}),
  });
  const r=await result.json();
  const art=r.output?.find(x=>x.type==='image_generation_call'&&x.result);
  const ledger = exists('image-usage.json') ? JSON.parse(read('image-usage.json')) : [];
  ledger.push({id,http:result.status,seconds:(Date.now()-start)/1000,returnedImage:!!art,usage:r.usage});
  json('image-usage.json',ledger);
  if(!art) throw Error(id+': '+result.status+' '+JSON.stringify(r.error??r.incomplete_details??r.status));
  save(name,Buffer.from(art.result,'base64'));
  console.log('Painted',id);
  return path.join(out,name);
}

fs.cpSync(runtimeDir,path.join(out,'runtime'),{recursive:true});
const data=Object.entries(theme).map(([id,t])=>{
  const draft=JSON.parse(read(id+'-draft.json'));
  return {id,t,draft,a:JSON.parse(draft.manifest.content.authoring_json)};
});
function cropGuide(source, name, { w, h }) {
  const fw=390, fh=844, s=Math.min(fw/w,fh/h);
  const cw=Math.round(w*s/2)*2, ch=Math.round(h*s/2)*2;
  ff(['-i',path.join(out,source+'.png'),'-vf',`crop=${cw}:${ch}:${Math.floor((fw-cw)/2)}:${Math.floor((fh-ch)/2)}`,
    '-frames:v','1',path.join(out,name+'.png')]);
}
if(phase==='prepare'||phase==='all') for(const {id,draft,a} of data) {
  capture(id+'-original',draft.manifest);
  capture(id+'-rough',build(placeholders(a),draft.manifest,id+'-rough'));
  cropGuide(id+'-rough',id+'-guide',JSON.parse(draft.manifest.content.game_json).presentation.canvas);
}
if(phase==='images'||phase==='all') {
  const jobs=[];
  for(const {id,t,draft,a} of data){
    const {w,h}=JSON.parse(draft.manifest.content.game_json).presentation.canvas;
    const base=`Paint the full-bleed static BACKGROUND layer for this portrait mobile game, at aspect ratio ${w}:${h}. Player request: ${draft.request} Game rules: ${a.meta.instructions} Art direction: ${t.style} The engine overlays the falling objects in the central area and a player that slides across the bottom. Keep those areas readable with low visual contrast in the background. Establish depth with detail around the outer edges and leave room for score and timer at the top. Paint only the setting. No gameplay objects, duplicate figures, lettering, score, HUD, buttons or watermarks.`;
    for(const variant of ['text','frame']) jobs.push(()=>paint(id+'-'+variant,base + (variant==='frame'?
      ' The attached rough gameplay frame shows the actual object locations and UI. Use it to place quiet and detailed areas. Omit its shapes and text from the finished background. Fill the exact crop edge to edge.':''),"1024x1536",variant==='frame'?id+'-guide.png':null));
    for(const [role,noun] of Object.entries(t.roles)) jobs.push(()=>paint(id+'-'+role,
      `Paint exactly one ${noun} as a clearly recognizable mobile game sprite. ${t.style} Full object centred, a generous blank margin, straight-on game sprite, silhouette readable at 36 pixels. Put it on a perfectly flat vivid green (#00FF00) background for extraction. Keep green out of the subject. No drop shadow, other objects, scenery, text, border or checkerboard.`,'1024x1024'));
  }
  let failed=false;
  // Dispatch across both games. Keep the total number of calls fixed.
  for(let i=0;i<jobs.length;i+=5) {
    for(const r of await Promise.allSettled(jobs.slice(i,i+5).map(job=>job()))) if(r.status==='rejected') {
      failed=true; console.error(r.reason.message);
    }
  }
  if(failed) process.exitCode=1;
}
if(phase==='assemble'||phase==='all') for(const {id,t,draft,a} of data) {
  const {w,h}=JSON.parse(draft.manifest.content.game_json).presentation.canvas;
  const art=structuredClone(a.art);
  const cut={};
  for(const role of Object.keys(t.roles)) {
    const source=id+'-'+role+'-source.png';
    if(!exists(source)) continue;
    try { cut[role]=cutSprite(path.join(out,source),art.sprites[role],id+'-'+role+'.webp'); }
    catch(e){console.error(e.message);}
  }
  Object.assign(art.sprites,cut);
  const results={cut:Object.keys(cut),variants:{}};
  for(const variant of ['text','frame']){
    const name=id+'-'+variant;
    if(!exists(name+'-source.png')) continue;
    const back=compressBackdrop(path.join(out,name+'-source.png'),w,h,name+'-backdrop.webp');
    art.backdrop={image:'data:image/webp;base64,'+back.toString('base64'),w,h};
    const manifest=build({...a,art},draft.manifest,name);
    json(name+'-manifest.json',manifest);
    capture(name,manifest);
    const game = JSON.parse(manifest.content.game_json);
    const gate = await studio.gate(JSON.stringify(game),1);
    results.variants[variant]={passed:gate.passed,summary:gate.summary,backdropBytes:back.length};
    console.log(name, results.variants[variant]);
  }
  json(id+'-results.json',results);
}

async function chooseHud(id, draft, base) {
  const file = id + '-hud-choice.json';
  if (exists(file)) return JSON.parse(read(file));
  if (!apiKey) throw Error('Missing Muse key');
  const game = JSON.parse(base.content.game_json);
  const a = JSON.parse(base.content.authoring_json);
  const options = hudOptions(game, a);
  const prompt = `Choose the HUD for this phone game. Reply as JSON with layout, panel, ink, warning, radius, hint, and reason. The panel, ink and warning fields are solid #RRGGBB colors for the counter panel, text, and urgent timer. Choose colors based on the attached game image and original palette. Keep panel and text strongly contrasted. Radius is 0–18. Hint is 'brief' if the opening needs a short reminder, or 'intro' if the title card rule suffices. The layout field must be a string key from these options: ${JSON.stringify(options)}. Account for controls and where objects travel over time. Game request: ${draft.request}. Rule: ${game.meta.instructions}. Palette: ${JSON.stringify(game.presentation.tokens)}. Game fragments: ${JSON.stringify(a.uses.map(({fragment,params})=>({fragment,params})))}.`;
  const response = await fetch('https://api.meta.ai/v1/chat/completions', {
    method:'POST', signal:AbortSignal.timeout(90_000),
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
    body:JSON.stringify({model:'muse-wonder-1.0',reasoning_effort:'low',max_tokens:4000,
      response_format:{type:'json_object'},messages:[{role:'user',content:[
        {type:'text',text:prompt},
        {type:'image_url',image_url:{url:'data:image/png;base64,'+read(id+'-hud-context.png').toString('base64')}},
      ]}]}),
  });
  const reply = await response.json();
  const choice = extractObject(reply.choices?.[0]?.message?.content);
  json(id+'-hud-decision-usage.json',{http:response.status,usage:reply.usage});
  if (!response.ok || !choice) throw Error(id+' HUD decision failed: HTTP '+response.status);
  json(file,choice);
  return choice;
}

function hudBackdrop(manifest, image) {
  const game = JSON.parse(manifest.content.game_json);
  const {w,h} = game.presentation.canvas;
  const imageData = compressBackdrop(image,w,h,manifest.id+'-backdrop.webp');
  const authoring = JSON.parse(manifest.content.authoring_json);
  authoring.art ??= {};
  authoring.art.backdrop = { image:'data:image/webp;base64,'+imageData.toString('base64'),w,h };
  return build(authoring,manifest,manifest.id);
}

function checkHud(base, result) {
  const reference = engine.load(base.content.game_json,base.seed);
  const changed = engine.load(result.manifest.content.game_json,base.seed);
  const panelColor = result.colors.panel.toUpperCase();
  let warningSeen = false;
  try {
    for (let tick=0; tick<=4800; tick++) {
      if (tick % 12 === 0) {
        if (reference.stateHash() !== changed.stateHash())
          throw Error('HUD changed game state at tick '+tick);
        let panel;
        for (const op of changed.frame().ops) {
          if (op.op === 'rect' && context.MicrogameEngine.rgbaToHex(op.fill) === panelColor &&
              result.regions.some(r=>r.x===op.x && r.y===op.y && r.w===op.w && r.h===op.h)) {
            panel = op;
          } else if (panel && (op.op === 'text' || op.op === 'image')) {
            const sx = op.w * op.scale, sy = op.h * op.scale;
            const x = op.x + (op.w-sx)/2, y = op.y + (op.h-sy)/2;
            if (x<panel.x-1 || y<panel.y-1 || x+sx>panel.x+panel.w+1 || y+sy>panel.y+panel.h+1)
              throw Error('HUD overflows its panel at tick '+tick+': '+(op.text ?? op.op));
            if (op.op === 'text' && op.text === '4s') warningSeen = true;
          } else panel = null;
        }
      }
      const phase = changed.step(16);
      if (phase !== reference.step(16)) throw Error('HUD changed game phase');
      if (phase !== 'playing') break;
    }
    return {warningSeen};
  } finally {
    reference.dispose();
    changed.dispose();
  }
}

if (phase === 'hud' || phase === 'hud-local') {
  const selected = process.argv.slice(6);
  const ids = ['moth','lunch',...(exists('tide-draft.json') ? ['tide'] : [])]
    .filter(id => !selected.length || selected.includes(id));
  const tasks = ids.map(id => {
    const draft = JSON.parse(read(id+'-draft.json'));
    const base = exists(id+'-frame-manifest.json') ? JSON.parse(read(id+'-frame-manifest.json')) : draft.manifest;
    const a = JSON.parse(base.content.authoring_json);
    const game = JSON.parse(base.content.game_json);
    const baseline = id+'-hud-before';
    capture(baseline,base);
    cropGuide(baseline,id+'-hud-context',game.presentation.canvas);
    return {id,draft,base,a,game};
  });
  const results = await Promise.allSettled(tasks.map(async ({id,draft,base,a,game}) => {
    const resultsFile = id+'-hud-results.json';
    const prior = exists(resultsFile) ? JSON.parse(read(resultsFile)) : {};
    const saveVariant = async (suffix, result) => {
      const name = id+'-hud-'+suffix;
      result.manifest.id = name;
      const checks = checkHud(base,result);
      capture(name,result.manifest);
      json(name+'-manifest.json',result.manifest);
      const report = await studio.gate(result.manifest.content.game_json,1);
      return {layout:result.layout,contrast:result.contrast,colors:result.colors,
        passed:report.passed,summary:report.summary,...checks};
    };
    const fixed = await saveVariant('fixed',applyHud(base,null,{fixed:true}));
    json(resultsFile,{...prior,fixed});
    const choice = await chooseHud(id,draft,base);
    let styled = applyHud(base,choice);
    let accepted = choice;
    try { checkHud(base,styled); }
    catch (e) {
      console.log(id,e.message,'– using the top bar');
      accepted = {...choice,layout:'top'};
      styled = applyHud(base,accepted);
    }
    const styledOnly = await saveVariant('styled',styled);
    const toned = await saveVariant('toned',applyHud(base,accepted,{calm:true}));
    json(resultsFile,{...prior,choice,fixed,styled:styledOnly,toned});
    if (phase === 'hud-local') return;
    const rough = build(placeholders(a),base,id+'-hud-guide');
    capture(id+'-hud-guide',applyHud(rough,accepted,{guide:true}).manifest);
    cropGuide(id+'-hud-guide',id+'-hud-mask',game.presentation.canvas);
    const {w,h} = game.presentation.canvas;
    const protectedRegions = styled.regions.map(r =>
      `x=${r.x} to ${r.x+r.w}, y=${r.y} to ${r.y+r.h}`).join('; ');
    const image = await paint(id+'-hud-reserved-'+styled.layout,
      `Paint only the background for this portrait ${w}×${h} game. Player request: ${draft.request}. Game rule: ${game.meta.instructions}. Art direction: ${a.art.style ?? 'Use the attached frame to understand the layout and the requested style.'} The bright pink blocks in the guide mark protected HUD areas (${protectedRegions}). Continue the setting through those areas using smooth, low-detail color that harmonizes with the HUD panel ${styled.colors.panel}. Keep strong shapes, highlights, hard edges and decorations away from these areas and the moving or interactive pieces. Show only the setting, with no pink guides, text, lettering, UI, characters, movable objects or symbols from the guide. Fill the frame edge to edge.`,
      '1024x1536',id+'-hud-mask.png');
    const adaptive = await saveVariant('adaptive',applyHud(hudBackdrop(base,image),accepted));
    json(resultsFile,{choice,fixed,styled:styledOnly,toned,adaptive});
    console.log(id,choice.layout,adaptive.layout,adaptive.summary);
  }));
  for (const result of results) if (result.status === 'rejected') {
    console.error(result.reason);
    process.exitCode = 1;
  }
}
