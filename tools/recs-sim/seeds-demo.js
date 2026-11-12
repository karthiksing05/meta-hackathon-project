#!/usr/bin/env node
// The recommender on the real seed Bubbles, through the same string bridge the app uses
// (GameRecs.app.load / rank / observe / exportState), with payloads shaped like
// GameRecommender.swift's. Shows the next 12 pages for a new person, then after a few sessions
// of someone who loves hooky Bubbles and someone who skips them.
//
//   node tools/recs-sim/seeds-demo.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const SEEDS = path.join(ROOT, "FacebookClone/Bubbles/Seeds");
const recsPath = path.join(ROOT, "FacebookClone/Bubbles/Recommend/game-recs.js");

function freshRecs() {
  delete require.cache[require.resolve(recsPath)];
  return require(recsPath);
}

// GameRecSummary.init(_:)
const manifests = fs.readdirSync(SEEDS)
  .filter((n) => n.startsWith("bubble-seed-") && n.endsWith(".json"))
  .sort()
  .map((n) => JSON.parse(fs.readFileSync(path.join(SEEDS, n), "utf8")));
const summaries = manifests.map((m) => {
  const scope = (m.structure && m.structure.scope) || "everyone";
  return {
    id: m.id,
    formula: m.formula,
    mood: (m.brief && m.brief.mood) || [],
    energy: (m.brief && m.brief.energy) || "medium",
    competition: (m.brief && m.brief.competition) || "friendly",
    look: (m.style && m.style.look) || "glow",
    scope: scope.startsWith("group") ? "group" : scope.startsWith("event") ? "event" : "everyone",
    isDaily: !!(m.structure && m.structure.cadence === "daily"),
    bots: []
  };
});

// Roughly BubbleStore.feedCandidates: every Bubble is "popular", plus Daily, icebreakers and a few
// friends' Bursts.
const candidates = [];
summaries.forEach((s, i) => {
  if (s.isDaily) candidates.push({ gameID: s.id, reason: "daily", runUserID: "sf-maya-okafor", weight: 3 });
  if (s.scope === "event") candidates.push({ gameID: s.id, reason: "icebreaker", runUserID: "sf-diego-ramirez", weight: 2 });
  if (i % 3 === 0) candidates.push({ gameID: s.id, reason: "friendBurst", runUserID: "sf-aiko-tanaka", weight: 2.2 });
  candidates.push({ gameID: s.id, reason: "popular", runUserID: null, weight: 0.8 });
});

function rankPages(app, feed, day, seed) {
  const input = { candidates, summaries, feed: feed.map((p) => p.gameID), feedKeys: feed.map((p) => p.gameID + "|" + p.reason + "|" + (p.runUserID || "-")), count: 12, seed, day };
  return JSON.parse(app.rank(JSON.stringify(input)));
}

function show(title, reply) {
  console.log("\n" + title + "   (bait lean " + reply.bait.lean.toFixed(2) + ")");
  reply.picks.forEach((p, i) => {
    console.log("  " + String(i + 1).padStart(2) + ". " + p.gameID.padEnd(30) + p.reason.padEnd(12) + "hook " + p.hook.toFixed(2) + " " + p.tier.padEnd(5) + (p.unproven ? "new  " : "     ") + p.why);
  });
  const hooky = reply.picks.filter((p) => p.tier === "high").length;
  console.log("  high-hook pages: " + hooky + "/12");
}

// Someone plays a few sessions; `likes(summary)` says how a page goes for them.
function playSessions(app, likes, sessions) {
  for (let day = 0; day < sessions; day++) {
    let feed = [];
    for (let batch = 0; batch < 2; batch++) {
      const reply = rankPages(app, feed, day, 100 + day * 10 + batch);
      feed = feed.concat(reply.picks);
      reply.picks.forEach((p) => {
        const s = summaries.find((x) => x.id === p.gameID);
        app.observe(JSON.stringify(Object.assign({ id: p.gameID, day }, likes(s, p))));
      });
    }
    app.endSession();
  }
}

const isHooky = (s) => ["dodge", "time"].includes(s.formula) || s.energy === "high";
const lover = (s) => isHooky(s)
  ? { dwellSec: 30, tookOver: true, runsFinished: 1, replays: 2, saved: s.id.length % 3 === 0 }
  : { dwellSec: 0.6 };
const averse = (s) => isHooky(s)
  ? { dwellSec: 8, tookOver: true, runsFinished: 0, quitMidRun: true }
  : { dwellSec: 40, tookOver: true, runsFinished: 1, replays: 1, addedFriend: s.scope !== "everyone" };

console.log("Recommender on the " + summaries.length + " seed Bubbles (no bot runs here; in the app they come from the roster)");

let R = freshRecs();
R.app.load("", "");
show("A new person", rankPages(R.app, [], 0, 1));

R = freshRecs();
R.app.load("", "");
playSessions(R.app, lover, 4);
const loverState = R.app.exportState();
show("After 4 sessions of someone who loves hooky Bubbles", rankPages(R.app, [], 5, 1));

R = freshRecs();
R.app.load("", "");
playSessions(R.app, averse, 4);
show("After 4 sessions of someone who skips out of hooky ones", rankPages(R.app, [], 5, 1));

R = freshRecs();
R.app.load(loverState, JSON.stringify({ stages: { reward: true, bandit: true, calibration: true, coldStart: true, bait: false } }));
show("The bait lover's state with the bait stage off (FB_RECS=reward,bandit,calibration,coldStart)", rankPages(R.app, [], 5, 1));
