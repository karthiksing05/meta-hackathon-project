#!/usr/bin/env node
"use strict";
// Typed text in microgames (docs/BUBBLES.md 7.11): drives a text-input game through the real Bubble
// runtime (the same kit, ticks and input queue the app's host uses), then checks that the run
// replays and verifies:
//   - typing and submitting reaches the engine and changes the score;
//   - the runtime's replay log records the text as {t, a: "text", v: [kind, value]} at its tick, and
//     replaying it (also after a sorted-key round trip, like Swift's JSONValue) gives the same run;
//   - the engine's own log (state.microgame.log) passes MicrogameEngine.verify; a raised score fails;
//   - edits within one tick coalesce, and games without a text input never log text.
//   node tools/runtime-tests/microgame-text.js
const fs = require("fs");
const path = require("path");
const { load, SEEDS } = require("./load.js");

const env = load();
const B = env.Bubble;
const ME = env.context.MicrogameEngine;
if (!ME || !ME.getEngine()) { console.log("skipped: no WebAssembly engine here"); process.exit(0); }
const engine = ME.getEngine();
const loaded = [];
const realLoad = engine.load.bind(engine);
engine.load = (json, seed) => { const g = realLoad(json, seed); loaded.push(g); return g; };

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log("  FAIL " + name + (detail ? ": " + detail : "")); }
}
const readSeed = (name) => JSON.parse(fs.readFileSync(path.join(SEEDS, "bubble-seed-" + name + ".json"), "utf8"));
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object"
  ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {}) : v;

const m = readSeed("mg-ferry-call");
console.log("Typed text in microgames (" + m.id + ")");

// ---- a live run: the host's queue, one tick at a time ----
loaded.length = 0;
const session = B.createSession(m);
const run = session.newRun({ mode: "play" });
const game = loaded[loaded.length - 1];
ok(!!game, "the kit loaded the game into the engine");
ok(run.textField && run.textField.w > 0 && run.textField.h > 0 && run.textField.max_len === 12 && run.textField.placeholder === "Type the word",
  "the kit asks the host for a text field at presentation.text_field", JSON.stringify(run.textField));
// presentation.text_field {x: 40, y: 470, w: 280, h: 48} on a 360 x 640 canvas fills the playfield 1:1.
ok(run.textField.x === 40 && run.textField.y === 470 && run.textField.w === 280 && run.textField.h === 48, "the field sits at the game's rect in playfield units");
run.begin();
const steps = (n) => { for (let i = 0; i < n && !run.ended; i++) run.step(); };
const typeWord = (word, wrong) => {
  for (let i = 1; i <= word.length; i++) { run.queue("text", "change", word.slice(0, i)); run.step(); }
  run.queue("text", "submit", word);
  run.queue("text", "change", "");
  run.step();
  steps(wrong ? 20 : 12);
};
steps(30);
const target = () => game.state().target;
const t0 = target();
// Two edits in one tick keep only the last value.
run.queue("text", "change", "x");
run.queue("text", "change", t0.slice(0, 1));
const before = run.log.length;
run.step();
ok(run.log.length === before + 1 && run.log[run.log.length - 1].v[1] === t0.slice(0, 1), "edits within one tick coalesce into one log entry");
ok(game.state().typed === t0.slice(0, 1), "an edit reaches the game's text change input", JSON.stringify(game.state().typed));
typeWord("zz", true);
ok(run.score === 0 && game.state().misses === 1, "a wrong answer scores nothing (and counts a miss)", "score " + run.score);
typeWord(t0, false);
ok(run.score === 10, "submitting the word on the sign scores", "score " + run.score);
const texts = run.log.filter((i) => i.a === "text");
ok(texts.length > 0 && texts.every((i) => Array.isArray(i.v) && i.v.length === 2 && (i.v[0] === "submit" || i.v[0] === "change") && typeof i.v[1] === "string" && Number.isInteger(i.t)),
  "text inputs are logged as {t, a: \"text\", v: [kind, value]}");
ok(texts.some((i) => i.v[0] === "submit" && i.v[1] === t0), "the submitted word is in the log at its tick");
while (!run.ended && run.tick < 60 * 60) {
  if (!run.ending) typeWord(target(), false);
  else run.step();
}
ok(run.ended && run.outcome === "success" && run.score === 60, "six right answers win the run", run.outcome + " " + run.score);

// ---- replays: the runtime log reproduces the run ----
const replay = run.replayLog();
const opts = (r) => JSON.stringify({ bot: false, replay: r, max_ticks: Math.max(r.total_ticks + 120, 600) });
const r1 = JSON.parse(B.simulateJSON(JSON.stringify(m), opts(replay)));
ok(r1.ok && r1.outcome === "success" && r1.score === run.score && r1.ticks === run.tick, "the replay log reproduces outcome, score and ticks",
  r1.outcome + " " + r1.score + " @" + r1.ticks + " vs " + run.score + " @" + run.tick + (r1.error ? " " + r1.error : ""));
ok(JSON.stringify(r1.replay.inputs) === JSON.stringify(replay.inputs), "the replayed run logs the same inputs");
const sorted = sortKeys(JSON.parse(JSON.stringify(replay)));
const r2 = JSON.parse(B.simulateJSON(JSON.stringify(sortKeys(m)), opts(sorted)));
ok(r2.ok && r2.score === run.score && r2.ticks === run.tick, "a sorted-key round trip (Swift's JSONValue) still replays", r2.score + " @" + r2.ticks);
// A replay without its text entries is a different run: the text is what scored.
const stripped = Object.assign({}, replay, { inputs: replay.inputs.filter((i) => i.a !== "text") });
const r3 = JSON.parse(B.simulateJSON(JSON.stringify(m), opts(stripped)));
ok(r3.ok && r3.score === 0, "dropping the text entries loses the score (the log carries it)", "score " + r3.score);

// ---- the engine's own log verifies ----
const mlog = run.state.microgame.log;
ok(typeof mlog === "string" && mlog.length > 0, "the run's microgame log is in state.microgame.log");
const v = ME.verify(m.content.game_json, mlog);
ok(v.ok, "MicrogameEngine.verify accepts the typed run", (v.problems || []).join("; "));
const bad = JSON.parse(mlog);
bad.final.score = (bad.final.score || 0) + 50;
ok(!ME.verify(m.content.game_json, bad).ok, "a raised score doesn't verify");

// ---- bots type too, and their runs replay and verify ----
let botRuns = 0, botWins = 0;
for (const o of [{ bot_seed: 1, bot_skill: 0.3 }, { bot_seed: 2, bot_skill: 0.7 }, { bot_seed: 3, bot_skill: 0.95 }]) {
  loaded.length = 0;
  const r = JSON.parse(B.simulateJSON(JSON.stringify(m), JSON.stringify(o)));
  const g = loaded[loaded.length - 1];
  const bt = r.replay ? r.replay.inputs.filter((i) => i.a === "text") : [];
  ok(r.ok && bt.some((i) => i.v[0] === "submit"), "the generic bot submits text (skill " + o.bot_skill + ")", r.error || "");
  const rr = JSON.parse(B.simulateJSON(JSON.stringify(m), opts(r.replay)));
  ok(rr.ok && rr.score === r.score && rr.ticks === r.ticks && rr.outcome === r.outcome, "a bot run replays exactly (skill " + o.bot_skill + ")");
  ok(g && ME.verify(m.content.game_json, g.log(true)).ok, "a bot run verifies (skill " + o.bot_skill + ")");
  botRuns++;
  if (r.outcome === "success") botWins++;
}
ok(botWins >= 1, "a skilled bot can win by typing", botWins + " of " + botRuns);

// ---- games without a text input are untouched ----
const plain = readSeed("mg-number-merge");
const pr = B.createSession(plain).newRun({ mode: "play" });
ok(pr.textField === null, "a game without a text input asks for no field");
pr.begin();
pr.queue("text", "submit", "hello");
pr.step();
pr.text("change", "x");
ok(!pr.log.some((i) => i.a === "text"), "text sent to a game without a text input is never logged");

console.log((failed ? "FAIL" : "ok") + ": " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
