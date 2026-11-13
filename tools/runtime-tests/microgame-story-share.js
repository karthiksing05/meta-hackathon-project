#!/usr/bin/env node
"use strict";
// Story share lines (harness-gaps/story.md, docs/BUBBLES.md 7.11): a microgame whose state has a
// non-empty `sg_share_line` uses it as the result's score_text, and its `ending`, `choices_used` and
// `sg_path` go in the result tag as `ending=<id>;choices=<n>;path=<dots>`. The same end state comes
// back from MicrogameEngine.verify(game, log, names) as `result`, for group play.
//   node tools/runtime-tests/microgame-story-share.js
const fs = require("fs");
const path = require("path");
const { load, SEEDS } = require("./load.js");

const env = load();
const B = env.Bubble;
const ME = env.context.MicrogameEngine;
if (!ME || !ME.getEngine()) { console.log("skipped: no WebAssembly engine here"); process.exit(0); }

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log("  FAIL " + name + (detail ? ": " + detail : "")); }
}

// A tiny story-shaped game: a "choice" every 200 ms, the ending after three.
const game = {
  format: "microgame/0.2",
  meta: { title: "Three Doors", instructions: "Pick a door three times.", duration_s: 10 },
  state: {
    choices_used: { type: "int", init: "0" },
    sg_path: { type: "string", init: "''" },
    ending: { type: "string", init: "''" },
    sg_share_line: { type: "string", init: "''" },
  },
  rules: [
    { id: "choose", on: { every: "200ms" }, when: "ending == ''", do: [
      { set: "sg_path", to: "if sg_path == '' then str(choices_used % 3) else sg_path + '.' + str(choices_used % 3)" },
      { incr: "choices_used" },
    ] },
    { id: "end", on: { every: "100ms" }, when: "ending == '' and choices_used >= 3", do: [
      { set: "ending", to: "'king'" },
      { set: "sg_share_line", to: "'I became king in ' + str(choices_used) + ' choices'" },
    ] },
  ],
  objectives: { win: "ending != ''", score: "100 - choices_used", time_limit: "10s", on_timeout: "lose" },
  presentation: {
    canvas: { w: 360, h: 640, background: "#101020" },
    root: { node: "text", text: "= sg_path", x: 180, y: 320, size: 24, color: "#FFFFFF" },
  },
};
const base = JSON.parse(fs.readFileSync(path.join(SEEDS, "bubble-seed-mg-ferry-call.json"), "utf8"));
const m = Object.assign({}, base, { id: "mg-story-share-test", title: "Three Doors", content: { game_json: JSON.stringify(game) } });

console.log("Story share line (" + m.id + ")");
const session = B.createSession(m);
const run = session.newRun({ mode: "play" });
run.begin();
while (!run.ended && run.tick < 60 * 12) run.step();
ok(run.ended && run.outcome === "success", "the story run ends with its ending", run.outcome);
ok(run.share && run.share.score_text === "I became king in 3 choices", "score_text is the story's share line", JSON.stringify(run.share));
ok(run.share && run.share.tag === "ending=king;choices=3;path=0.1.2", "the tag carries ending, choices and path", run.share && run.share.tag);

const log = run.state && run.state.microgame && run.state.microgame.log;
ok(typeof log === "string" && log.length > 0, "the run keeps the engine's log");
const v = ME.verify(m.content.game_json, log, ["ending", "choices_used", "nope"]);
ok(v.ok, "the log verifies", JSON.stringify(v.problems));
ok(v.result && v.result.ending === "king" && v.result.choices_used === 3 && v.result.nope === null,
  "verify returns the named end state from the replay", JSON.stringify(v.result));
const all = ME.verify(m.content.game_json, log);
ok(all.result && all.result.sg_share_line === "I became king in 3 choices", "without names, verify returns all of the end state", JSON.stringify(all.result));

// A game without story state keeps "N points" and no tag.
const plain = B.createSession(base).newRun({ mode: "demo" });
plain.begin();
for (let i = 0; i < 120 && !plain.ended; i++) plain.step();
const plainShare = plain.share || plain.buildShare();
ok(plainShare && / points/.test(plainShare.score_text) && !plainShare.tag, "other microgames keep points and no tag", JSON.stringify(plainShare));

console.log((failed ? "FAILED: " : "ok: ") + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
