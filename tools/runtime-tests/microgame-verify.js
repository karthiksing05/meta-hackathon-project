#!/usr/bin/env node
"use strict";
// Challenges and leaderboards can trust a microgame score only if the run's input log replays to
// the same result. This plays every microgame seed through the real Bubble runtime (the same kit,
// bot and 60 Hz ticks as the app), takes the engine's input log (microgame-log/1, what the kit puts
// in state.microgame.log when a run ends), and checks it with MicrogameEngine.verify: the honest log
// must verify, and the same log with a raised score must not.
//   node tools/runtime-tests/microgame-verify.js
const fs = require("fs");
const { load, SEEDS } = require("./load.js");

const env = load();
const ME = env.context.MicrogameEngine;
if (!ME || !ME.getEngine()) { console.log("skipped: no WebAssembly engine here"); process.exit(0); }
const engine = ME.getEngine();
const loaded = [];
const realLoad = engine.load.bind(engine);
engine.load = (json, seed) => { const g = realLoad(json, seed); loaded.push(g); return g; };

let failures = 0, runs = 0;
for (const f of fs.readdirSync(SEEDS).filter((x) => x.startsWith("bubble-seed-mg-")).sort()) {
  const m = JSON.parse(fs.readFileSync(SEEDS + "/" + f, "utf8"));
  for (const opts of [{ bot_seed: 1, bot_skill: 0.3 }, { bot_seed: 2, bot_skill: 0.7 }, { bot_seed: 3, bot_skill: 0.95 }]) {
    loaded.length = 0;
    const r = JSON.parse(env.Bubble.simulateJSON(JSON.stringify(m), JSON.stringify(opts)));
    const game = loaded[loaded.length - 1];
    if (!r.ok || !game) { failures++; console.log("FAIL " + f + ": the run didn't play: " + r.error); continue; }
    runs++;
    const log = game.log(true);
    const v = ME.verify(m.content.game_json, log);
    if (!v.ok) { failures++; console.log("FAIL " + f + " " + JSON.stringify(opts) + ": an honest run didn't verify: " + v.problems.join("; ")); }
    const bad = JSON.parse(log);
    bad.final.score = (bad.final.score || 0) + 50;
    if (ME.verify(m.content.game_json, bad).ok) { failures++; console.log("FAIL " + f + ": a raised score verified"); }
  }
}
console.log(failures ? failures + " failure(s)" : "ok: " + runs + " runtime-driven microgame runs verify; raised scores are rejected");
process.exit(failures ? 1 : 0);
