import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const [outputDir, ...args] = process.argv.slice(2);
if (!outputDir) throw Error('Usage: node authoring/harness/generate.mjs <output directory> [--repair] [game ids...]');
const out = path.resolve(outputDir);
fs.mkdirSync(out,{recursive:true});
const read = (file) => fs.readFileSync(file, 'utf8');
const save = (file, data) => fs.writeFileSync(path.join(out, file), JSON.stringify(data, null, 2) + '\n');
const key = process.env.MUSE_API_KEY || (fs.existsSync(path.join(repo,'.env')) ? read(path.join(repo, '.env')) : '').match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!key) throw new Error('No Muse API key configured');
const model = 'muse-wonder-1.0';
const endpoint = 'https://api.meta.ai/v1/';
const {cases,shared}=await import('./briefs.mjs');
const budgetFile=path.join(out,'transfer-budget.json');
const ledger=fs.existsSync(budgetFile)?JSON.parse(read(budgetFile)):[];
const flush=()=>save('transfer-budget.json',ledger);
function reserve(label,max,payload){
 const ceiling=(max*20+(Buffer.byteLength(JSON.stringify(payload))+256)*4)/1e6;
 if(ledger.reduce((n,r)=>n+r.usd,0)+ceiling>5)throw Error('Budget cap');
 const r={label,usd:ceiling,status:'reserved'}; ledger.push(r);flush();return r;
}
async function ask(label,messages,max_tokens){
 const body={model,messages,max_tokens,reasoning_effort:'low',response_format:{type:'json_object'}};
 const r=reserve(label,max_tokens,body);
 const start=performance.now();
 try {
  const res=await fetch(endpoint+'chat/completions',{ method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(145000),redirect:'error'});
  if(!res.ok){if(res.status>=400&&res.status<500)r.usd=0;throw Error('HTTP '+res.status);}
  const reply=await res.json(), usage=reply.usage??{}, choice=reply.choices?.[0]??{};
  if(Number.isInteger(usage.prompt_tokens)&&Number.isInteger(usage.completion_tokens))r.usd=(usage.prompt_tokens*4+usage.completion_tokens*20)/1e6;
  r.status='complete';r.seconds=Math.round((performance.now()-start)/100)/10;r.usage=usage;r.finish=choice.finish_reason;flush();
  return JSON.parse((choice.message?.content??'').trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g,''));
 }catch(e){r.status=e?.cause?.code??e.message; if(r.status==='ENOTFOUND'||r.status==='EAI_AGAIN')r.usd=0;flush();throw e;}
}
const contract='Return a JSON object with a manifest field containing one microgame-authoring/0.1 game manifest, with authoring, meta, uses, state, inputs, rules, objectives, presentation, and look. uses is an array of objects with a fragment key. It can be empty. 360×640. Use v0.1 shapes. No image or art assets in the manifest. Support browser pointer controls. First priority is playable behavior that matches the brief.';
const structured='First plan the rule contract with exact inputs, initial state, rule order and finish conditions. Provide it in a separate plan key with one normal trace and two edge cases, including expected state and outcome. Use the supplied syntax example as a reference, not as the rules of this game. Only use fragment parameters and bindings you can substantiate; an empty uses list is fine. Keep rules minimal; tick delta is event.dt. Put every draw node in presentation.slots under playfield. Use <= notation for inclusive thresholds. Check that state, events and inputs exist and all click targets use the brief coordinates.';
const artContract='Return JSON mapping backdrop and emblem to two standalone SVG strings. Use a 360×640 viewBox for backdrop, 64×64 for emblem, explicit width and height, and xmlns. The emblem has a transparent background and should fit a 40–60 px game draw. Only geometry, fill and stroke and local gradients. No text, script, foreignObject, external or embedded images, links, animation, or CSS stylesheets.';
const artStructured='Treat these as one asset set. Establish 1 shared palette of 5 colors and reserve the brightest color for the emblem. Backdrop needs an unbusy central playfield and calm top 104 px so the HUD and existing controls remain legible. Place detail at edges, keep a clear primary silhouette at actual size. The emblem has a 4px gutter, bold outer shape, and one unmistakable feature. Before returning, check element bounds and that the two assets share materials, motif and palette.';
const repair=args.includes('--repair');
const ids=args.filter(arg=>arg!=='--repair');
const jobs=cases.filter(c=>!ids.length||ids.includes(c.id)).flatMap(c=>['plain','structured'].flatMap(v=>repair?[['logic',c,v]]:[['logic',c,v],['art',c,v]]));
const report=repair?JSON.parse(read(path.join(out,'transfer-results.json'))):null;
async function run([kind,c,v]){
 const stem=c.id+'-'+kind+'-'+v;
 const label=stem+(repair?'-repair':'');
 if(fs.existsSync(path.join(out,label+'.json')))return;
 const fixture=kind==='logic'&&(repair||v==='structured')?read(path.join(repo,'authoring/games',c.fixture+'.authoring.json')):'';
 const sys=kind==='art'?artContract+(v==='structured'?' '+artStructured:''):contract+(v==='structured'?' '+structured+'\nSyntax example: '+fixture:'');
 const user=kind==='art'?c.title+'. '+c.art:c.title+'. '+shared+' '+c.brief;
 const messages=[{role:'system',content:sys},{role:'user',content:user}];
 if(repair){
   const entry=report.logic.find(e=>e.game===c.id&&e.variant===v&&e.round===0);
   if(!entry||(entry.checks?.length&&entry.checks.every(t=>t.passed)))return;
   const prior=JSON.parse(read(path.join(out,stem+'.json')));
   const diags=(entry.diagnostics??[]).filter(d=>d.severity==='error').slice(0,22).map(d=>[d.at,d.message]);
   const failures=(entry.checks??[]).filter(t=>!t.passed).map(t=>[t.name,t.error]);
   messages.push({role:'assistant',content:JSON.stringify(prior)}, {role:'user',content:
     'Return a complete repaired manifest. Use this working manifest as syntax reference: '+fixture+
     '\nUse one existing look id from paper, neon, pixel, riso. State and inputs are keyed objects. No unknown fields. A rule uses on, when, do. Use on_tap with input and with payload on visible rects. Do not emit undeclared win or lose events; objectives handle outcomes. Fix all instances of each issue. Validator diagnostics: '+JSON.stringify(diags)+'; expander error: '+(entry.error??'none')+'; replay failures: '+JSON.stringify(failures)});
 }
 const result=await ask(label,messages,kind==='art'?5200:11000);
 save(label+'.json',result);
 console.log(label,'returned');
}
let next=0;
await Promise.all(Array.from({length:5},async()=>{while(next<jobs.length){const job=jobs[next++];try{await run(job);}catch(e){console.error(job.map(x=>x.id??x).join('-'),e?.cause?.code??e.message);process.exitCode=1;}}}));
console.log('Metered or reserved $'+ledger.reduce((n,x)=>n+x.usd,0).toFixed(4));
