// Makes data/scores.json: what each person in the demo cast scores on each seed game, from real bot
// runs of the game runtime (the same `Bubble.simulate` the app used for its boards), so the server's
// leaderboards and "a friend's best run" facts come from play, not from made-up numbers.
//
//   node backend/internal/seed/tools/make-scores.cjs        (from the repo root)
//
// Skill per person is the one the app's roster used (BubbleRoster.skill). Rerun when the seed games or the
// runtime change, and commit the result.
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "..", "..", "..");
const { load } = require(path.join(root, "tools", "runtime-tests", "load.js"));
const dataDir = path.join(__dirname, "..", "data");

const SKILL = {
  "sf-maya-okafor": 0.9, "sf-diego-ramirez": 0.8, "sf-aiko-tanaka": 0.84, "sf-lena-fischer": 0.74, "sf-chloe-nguyen": 0.7,
  "sf-theo-adeyemi": 0.66, "sf-priya-natarajan": 0.6, "sf-sam-whitfield": 0.55, "sf-jordan-brooks": 0.5, "sf-omar-haddad": 0.44,
};

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

const { Bubble } = load();
const world = JSON.parse(fs.readFileSync(path.join(dataDir, "world.json"), "utf8"));
const people = world.people.map((p) => p.id);
const out = { skills: {}, scores: {} };
for (const id of people) out.skills[id] = SKILL[id] ?? 0.34 + (fnv("skill|" + id) % 10000) / 10000 * 0.56;

let runs = 0, kept = 0;
for (const file of fs.readdirSync(path.join(dataDir, "games")).filter((f) => f.endsWith(".json")).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(dataDir, "games", file), "utf8"));
  const gameID = m.id;
  for (const person of people) {
    runs++;
    const r = Bubble.simulate(m, { bot_skill: out.skills[person], bot_seed: fnv("bot|" + gameID + "|" + person) % 1000000 });
    if (r.ok && Number.isFinite(r.score) && r.score > 0) {
      (out.scores[gameID] = out.scores[gameID] || {})[person] = Math.round(r.score);
      kept++;
    }
  }
}
fs.writeFileSync(path.join(dataDir, "scores.json"), JSON.stringify(out, null, 1) + "\n");
console.log("simulated " + runs + " runs, kept " + kept + " scores for " + Object.keys(out.scores).length + " games");
