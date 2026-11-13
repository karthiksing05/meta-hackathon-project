#!/usr/bin/env node
// Group Blend on the real demo world: the "New in SF" cast (synthetic profiles steered by their
// bios) plus you, over the seed Bubbles, through the same string bridge the app uses
// (GameRecs.app.groupBlend).
//
//   node tools/recs-sim/blend-demo.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const SEEDS = path.join(ROOT, "FacebookClone/Bubbles/Seeds");
const R = require(path.join(ROOT, "FacebookClone/Bubbles/Recommend/game-recs.js"));

const world = JSON.parse(fs.readFileSync(path.join(SEEDS, "bubble-demo-world.json"), "utf8"));
// BubbleRoster.skill(of:), copied for the demo.
const SKILL = { "sf-maya-okafor": 0.9, "sf-diego-ramirez": 0.8, "sf-aiko-tanaka": 0.84, "sf-lena-fischer": 0.74, "sf-chloe-nguyen": 0.7, "sf-theo-adeyemi": 0.66, "sf-priya-natarajan": 0.6, "sf-sam-whitfield": 0.55, "sf-jordan-brooks": 0.5, "sf-omar-haddad": 0.44 };

const summaries = fs.readdirSync(SEEDS).filter((n) => n.startsWith("bubble-seed-")).sort().map((n) => {
  const m = JSON.parse(fs.readFileSync(path.join(SEEDS, n), "utf8"));
  const scope = (m.structure && m.structure.scope) || "everyone";
  return {
    id: m.id, formula: m.formula, mood: m.brief.mood, energy: m.brief.energy, competition: m.brief.competition,
    look: m.style.look, scope: scope.startsWith("group") ? "group" : scope.startsWith("event") ? "event" : "everyone",
    isDaily: m.structure.cadence === "daily", bots: [],
    creatorID: m._seed && m._seed.creator_id, groupID: (m._seed && m._seed.group_id) || (scope.startsWith("group:") ? scope.slice(6) : undefined)
  };
});

function members(ids, me) {
  const out = [{ id: "me", name: "You", isMe: true, skill: { overall: me } }];
  ids.forEach((id) => {
    const p = world.people.find((x) => x.id === id);
    out.push({ id, name: p.first_name, isFriend: p.is_friend, skill: { overall: SKILL[id] }, hints: { bio: p.intro, themes: [p.neighborhood] } });
  });
  return out;
}

function show(title, reply) {
  console.log("\n" + title + "   (cohesion " + reply.cohesion.toFixed(2) + ", " + reply.aggregate + ")");
  reply.members.forEach((m) => console.log("  member " + m.name.padEnd(7) + " likes " + m.topFormula.padEnd(7) + m.topMood.padEnd(8) + " lean " + m.lean.toFixed(2) + (m.synthetic ? "  (synthetic)" : "")));
  reply.picks.forEach((p, i) => console.log("  " + String(i + 1).padStart(2) + ". " + p.gameID.padEnd(30) + p.label.padEnd(26) + "all-enjoy " + p.everyone.toFixed(2) + "  min " + p.minEnjoy.toFixed(2) + (p.skillPlus > 0 ? "  skill+" + p.skillPlus.toFixed(2) : "") + "   " + p.why));
  console.log("  Blend game: " + reply.spec.formula + " / " + reply.spec.mood.join("+") + " / " + reply.spec.look + " / energy " + reply.spec.energy + " / " + reply.spec.competition);
  console.log("  why:    " + reply.spec.why);
  console.log("  prompt: " + reply.spec.prompt);
  reply.twins.forEach((t) => console.log("  twin:   " + t.name + " (" + t.similarity.toFixed(2) + ") " + t.why + (t.evenlyMatched ? ", evenly matched" : "")));
}

const group = { id: world.group.id, name: world.group.name };
const cast = ["sf-maya-okafor", "sf-priya-natarajan", "sf-sam-whitfield", "sf-chloe-nguyen", "sf-lena-fischer"];

// You, after a few sessions of liking calm guessing games and skipping fast ones.
R.app.load("", "");
const calmGuess = new Set(["guess", "answer", "group"]);
for (let day = 0; day < 4; day++) {
  const reply = JSON.parse(R.app.rank(JSON.stringify({ candidates: summaries.map((s) => ({ gameID: s.id, reason: "popular", weight: 1 })), summaries, feed: [], count: 12, seed: 7 + day, day })));
  reply.picks.forEach((p) => {
    const s = summaries.find((x) => x.id === p.gameID);
    const imp = calmGuess.has(s.formula) ? { dwellSec: 40, tookOver: true, runsFinished: 1, replays: 1 } : { dwellSec: 0.6 };
    R.app.observe(JSON.stringify(Object.assign({ id: s.id, day }, imp)));
  });
  R.app.endSession();
}

const input = { group, members: members(cast, 0.6), summaries, feed: [], count: 8, day: 5 };
show("New in SF Blend: you + Maya, Priya, Sam, Chloe, Lena", JSON.parse(R.app.groupBlend(JSON.stringify(input))));

const pair = { group, members: members(["sf-chloe-nguyen"], 0.62), summaries, feed: [], count: 4, day: 5 };
show("Pair Blend: you + Chloe (for Challenge Me)", JSON.parse(R.app.groupBlend(JSON.stringify(pair))));

console.log("\nSame group, other ways to combine (top 5 and the worst-off member's predicted enjoyment):");
["mean", "min", "centroid", "geometric"].forEach((how) => {
  R.app.load(R.app.exportState(), JSON.stringify({ blend: { aggregate: how } }));
  const reply = JSON.parse(R.app.groupBlend(JSON.stringify(input)));
  const top = reply.picks.slice(0, 5);
  const worst = Math.min(...top.map((p) => p.minEnjoy));
  const avgMin = top.reduce((a, p) => a + p.minEnjoy, 0) / top.length;
  console.log("  " + how.padEnd(10) + top.map((p) => p.gameID).join(", ") + "   (avg min " + avgMin.toFixed(2) + ", worst " + worst.toFixed(2) + ")");
});
