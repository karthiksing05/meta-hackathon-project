#!/usr/bin/env node
// Runs the formula kit tests in Node.
//
//   node tools/kits-tests/run-node.js [--quick] [--verbose] [--formula answer,time] [--report out.json]
//
// Loads the scripts in the runtime's load order (docs/BUBBLES.md 4.6): bubble-runtime.js, then
// bubble-kit-common.js, then every other bubble-kit-*.js by name, all from
// FacebookClone/Bubbles/Runtime/web. Prints a FINGERPRINT line that run-jsc.sh must match.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repo = path.resolve(__dirname, "..", "..");
const web = path.join(repo, "FacebookClone", "Bubbles", "Runtime", "web");
const seedsDir = path.join(repo, "FacebookClone", "Bubbles", "Seeds");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

function load(file) {
  const src = fs.readFileSync(file, "utf8");
  vm.runInThisContext(src, { filename: file });
}

load(path.join(web, "bubble-runtime.js"));
load(path.join(web, "bubble-kit-common.js"));
const kits = fs.readdirSync(web).filter((n) => /^bubble-kit-.*\.js$/.test(n) && n !== "bubble-kit-common.js").sort();
for (const k of kits) load(path.join(web, k));

const KitTests = require("./kits-tests-core.js");
const seeds = fs.readdirSync(seedsDir).filter((n) => /^bubble-seed-.*\.json$/.test(n)).sort().map((n) => path.join(seedsDir, n));
const formulas = opt("--formula") ? opt("--formula").split(",") : undefined;
console.log("Node " + process.version + " · real runtime " + Bubble.version);
if (Bubble.catalog && Bubble.catalog().load_warnings && Bubble.catalog().load_warnings.length) console.log("LOAD WARNINGS:\n  " + Bubble.catalog().load_warnings.join("\n  "));
const t0 = Date.now();
const result = KitTests.run({
  print: (s) => console.log(s),
  readText: (p) => fs.readFileSync(p, "utf8"),
  seeds,
  quick: flag("--quick"),
  verbose: flag("--verbose"),
  formulas,
});
console.log("(" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
if (opt("--report")) fs.writeFileSync(opt("--report"), JSON.stringify(result.report, null, 2));
process.exit(result.failures.length ? 1 : 0);
