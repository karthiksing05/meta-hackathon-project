import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './briefs.mjs';
import { referenceGame } from './controls.mjs';
import { runChecks } from './checks.mjs';
import { expand, loadLibrary, translate } from '../expander/expand.mjs';
import { loadEngine } from '../expander/engine.mjs';

const dir = process.argv[2];
if (!dir) throw Error('Usage: node authoring/harness/evaluate.mjs <Muse outputs directory>');
const authoring = fileURLToPath(new URL('../', import.meta.url));
const lib = loadLibrary(authoring);
const {engine} = await loadEngine();
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name+'.json'), 'utf8'));
const save = (name,value) => fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value,null,2)+'\n');
const variants = ['plain','structured'];
const report = [];
const cards = [];
function validate(game) { return engine.validate(JSON.stringify(game)); }

function compile(c, v, round) {
  const entry = {game:c.id,variant:v,round,stage:'reply'};
  report.push(entry);
  try {
    const reply = read(c.id+'-logic-'+v+(round?'-repair':''));
    const { plan } = reply;
    const manifest = reply.manifest ?? (round && reply.authoring ? reply : undefined);
    if (!manifest) throw Error('Expected a manifest object');
    entry.plan = plan;
    entry.stage = 'expand';
    const ex = expand(manifest,lib);
    entry.diagnostics = ex.diagnostics;
    if (entry.diagnostics.some(d=>d.severity==='error')) return entry;
    entry.stage = 'validate';
    entry.diagnostics.push(...validate(ex.game).map(d=>translate(d,ex.sourceMap)));
    if (entry.diagnostics.some(d=>d.severity==='error')) return entry;
    entry.stage = 'playable';
    ex.game.meta.seed=1;
    entry.checks = runChecks(engine,ex.game,c.id);
    save(c.id+'-'+v+'-'+round+'-transfer-game',ex.game);
    return {...entry,gameJSON:ex.game};
  } catch (error) { entry.error=error.message; return entry; }
}

function loadArt(c, variant) {
  const pack=read(c.id+'-art-'+variant);
  const assets={};
  for(const [name,w,h] of [['backdrop',360,640],['emblem',64,64]]){
    const svg=pack[name];
    if(typeof svg!=='string'||!/^<svg[\s>]/.test(svg)||!/<\/svg>\s*$/.test(svg)
      || !new RegExp('viewBox=["\']0 0 '+w+' '+h+'["\']').test(svg)
      || /<!|<\?|<\s*\/?\s*(?:script|foreignObject|iframe|image|use|style|animate\w*|set|a)(?:[\s/>])|\bon\w+\s*=|\b(?:href|src)\s*=|url\(\s*[^#]|@import/i.test(svg)) {
      throw Error('Invalid SVG contract: '+name);
    }
    assets[name]={svg,w,h};
  }
  return assets;
}

function applyArt(c, base, variant) {
  const assets=loadArt(c,variant);
  const game=structuredClone(base);
  game.format='microgame/0.2';
  game.assets=assets;
  const {x,y,size}=c.cue;
  const trackMoth=c.id==='grove';
  const emblem={node:'image',asset:'emblem',x:trackMoth?'= px - '+size/2:x-size/2,y:trackMoth?'= py - '+size/2:y-size/2,w:size,h:size};
  const root=game.presentation.root;
  const background={node:'image',asset:'backdrop',x:0,y:0,w:360,h:640,opacity:.64};
  if(root.node!=='group')throw Error('Expected a group to compose the art');
  root.children.unshift(background);
  root.children.push(emblem);
  const errors=validate(game).filter(d=>d.severity==='error');
  if(errors.length)throw Error(errors.map(d=>d.message).join(' · '));
  return game;
}
function describe(entry) {
  if(entry.checks) {
    const failed=entry.checks.filter(t=>!t.passed);
    return (entry.checks.length-failed.length)+'/'+entry.checks.length+' mechanic checks passed.'+
      (failed.length?' Failed: '+failed.map(t=>t.name).join(', ')+'.':'');
  }
  return entry.error??entry.diagnostics?.find(d=>d.severity==='error')?.message??'No game.';
}
const artReport=[];
for(const [caseIndex,c] of cases.entries()){
  const entries=variants.flatMap(v=>[0,1].filter(round=>!round||fs.existsSync(path.join(dir,c.id+'-logic-'+v+'-repair.json'))).map(round=>compile(c,v,round)));
  let base=entries.find(e=>e.checks?.length&&e.checks.every(t=>t.passed));
  if(!base){
    const control=referenceGame(c.id);
    if(control){
      const errors=validate(control).filter(d=>d.severity==='error');
      if(errors.length)throw Error(JSON.stringify(errors));
      const checks=runChecks(engine,control,c.id);
      if(!checks.every(t=>t.passed))throw Error(c.id+' reference: '+JSON.stringify(checks.filter(t=>!t.passed)));
      base={variant:'reference',gameJSON:control,checks};
    }
  }
  const card={id:c.id,title:c.title,brief:c.brief,visual:'Art A and B use the same game and inputs. The prompt labels are hidden for review.',drafts:[]};
  for(const entry of entries){
    const d={id:entry.variant+entry.round,label:(entry.variant==='plain'?'Plain logic prompt':'Structured logic prompt')+(entry.round?' · repair':''),result:describe(entry)};
    if(entry.gameJSON){
      d.games={preset:entry.gameJSON};
      d.replay=entry.checks.filter(t=>t.passed).sort((a,b)=>b.replay.length-a.replay.length)[0]?.replay??[];
      d.caption=d.result;
    }
    card.drafts.push(d);
  }
  const order=caseIndex%2?['structured','plain']:['plain','structured'];
  const ar={game:c.id,base:base?.variant,order,results:[]};
  artReport.push(ar);
  card.sheets={};
  for(const [index,v] of order.entries()){
    const key=index?'artB':'artA';
    try {
      const pack=loadArt(c,v);
      for(const [name,asset] of Object.entries(pack))card.sheets[key+' '+name]=asset.svg;
    } catch { /* Missing art stays absent. */ }
  }
  if(base){
    const d={id:'art',label:'Blind art comparison',games:{preset:base.gameJSON},replay:base.checks.filter(t=>t.final?.phase==='won').sort((a,b)=>b.replay.length-a.replay.length)[0]?.replay??[],
      result:base.variant==='reference'?'Same hand-built reference for both art treatments.':'Same '+base.variant+' Muse build for both art treatments.',caption:'Compare the game at its actual size before checking the prompt key.'};
    for(const [index,v] of order.entries()){
      try {
        const game=applyArt(c,base.gameJSON,v);
        const checks=runChecks(engine,game,c.id);
        const match=JSON.stringify(checks.map(t=>t.passed))===JSON.stringify(base.checks.map(t=>t.passed));
        const sameReplay=checks.every((t,i)=>!t.passed||JSON.stringify(t.final)===JSON.stringify(base.checks[i].final));
        if(!match||!sameReplay)throw Error('The art changed a test outcome');
        d.games[index?'artB':'artA']=game;
        ar.results.push({variant:v,passed:true});
      } catch(error){ar.results.push({variant:v,passed:false,error:error.message});}
    }
    card.drafts.unshift(d);
    card.defaultDraft='art';
    card.defaultArt=d.games.artA?'artA':d.games.artB?'artB':'preset';
  }
  cards.push(card);
}
const usage=read('transfer-budget').filter(r=>r.usd>0);
save('transfer-results',{logic:report,art:artReport,usage,spend:usage.reduce((n,r)=>n+r.usd,0)});
save('transfer-cards',cards);
for(const item of report) console.log(item.game,item.variant,item.round,item.stage,describe(item));
for(const item of artReport) console.log('art',item.game,JSON.stringify(item.results));
