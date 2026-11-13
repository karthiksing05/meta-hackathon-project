// node authoring/harness/gate-async-timing-experiment.mjs manifest.json [more...]   -> async gate with timing
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { loadEngine } from '../expander/engine.mjs';
import { playtestAsync } from '../playtest/gate-async.mjs';
const A = fileURLToPath(new URL('..', import.meta.url));
const lib = loadLibrary(A);
const { engine } = await loadEngine();
let total = 0, medSum = 0;
for (const f of process.argv.slice(2)) {
  const m = JSON.parse(readFileSync(f, 'utf8'));
  const r = expand(m, lib);
  const res = await playtestAsync(engine, JSON.stringify(r.playtestGame ?? r.game));
  total += res.ms; const secs=res.runs.map(x=>x.seconds).sort((a,b)=>a-b); medSum=(globalThis.medSum||0)+secs[2]; globalThis.medSum=medSum;
  console.log(`${basename(f).replace('.authoring.json','')}\t${res.passed ? 'PASS' : 'FAIL'}\t${res.ms} ms\t${res.runs.map(x=>`${x.outcome[0]}${x.score}/${Math.round(x.seconds)}s`).join(' ')}\t${res.flags.map(x=>(x.blocking?'!':'')+x.code).join(',')}`);
}
console.log('total ms', total, 'median-sum', Math.round(globalThis.medSum));
