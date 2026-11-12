#!/usr/bin/env node
// Runs the recommender checks in Node, with no npm packages.
//
//   node tools/recs-sim/run-node.js
"use strict";
const path = require("path");
const R = require(path.join(__dirname, "../../FacebookClone/Bubbles/Recommend/game-recs.js"));
const runRecsChecks = require("./checks.js");
const { runBlendChecks } = require("./checks.js");

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log("  FAIL " + name + (detail !== undefined ? ": " + detail : "")); }
}
console.log("Game recommender checks (node " + process.version + ", recs " + R.version + ")");
runRecsChecks(R, ok);
runBlendChecks(R, ok);
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
