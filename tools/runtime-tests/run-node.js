#!/usr/bin/env node
// Runs the Bubble runtime tests in Node with no DOM and no npm packages.
//
//   node tools/runtime-tests/run-node.js            full run
//   node tools/runtime-tests/run-node.js --quick    fewer bot runs
//   node tools/runtime-tests/run-node.js --web DIR --seeds DIR   test another copy
//
// Node-only checks (load order, no DOM, host page script list) run here; everything else is in
// checks.js, which run-jsc.sh runs again inside JavaScriptCore.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { load, seedFiles, orderedScriptNames, WEB, SEEDS } = require("./load");

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const web = path.resolve(opt("--web", WEB));
const seedsDir = path.resolve(opt("--seeds", SEEDS));
const quick = argv.includes("--quick");
// CPU time of this process: stable on a busy machine, where wall time mostly measures the neighbours.
const now = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

let passed = 0;
let failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log("  FAIL " + name + (detail ? ": " + detail : "")); }
}

console.log("Bubble runtime tests (node " + process.version + ")");
console.log("web:   " + web + "\nseeds: " + seedsDir);

console.log("\nLoading with no DOM");
const loaded = load(web);
const { Bubble, BubbleHost, files, logs, loadMs, context } = loaded;
const names = fs.readdirSync(web).filter((n) => n.endsWith(".js"));
ok(files[0] === "bubble-runtime.js" && files[1] === "bubble-kit-common.js", "runtime loads first, then the common kit", files.join(", "));
ok(JSON.stringify(files.slice(2)) === JSON.stringify(files.slice(2).slice().sort()), "other kits load in name order");
ok(typeof context.document === "undefined" && typeof context.window === "undefined", "no DOM globals appear");
ok(typeof BubbleHost === "undefined", "BubbleHost stays undefined without a DOM");
ok(!logs.some((l) => /error|crash/i.test(l)), "no errors logged while loading", logs.join(" | "));
console.log("  loaded " + files.length + " files in " + loadMs.toFixed(1) + " ms");

// The host page and the preview load the same files in the same order.
function scriptList(html, prefix) {
  return [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s.endsWith(".js")).map((s) => s.replace(prefix, ""));
}
const expected = orderedScriptNames(names);
const hostHTML = fs.readFileSync(path.join(web, "bubble-host.html"), "utf8");
ok(JSON.stringify(scriptList(hostHTML, "")) === JSON.stringify(expected), "bubble-host.html loads every runtime file in order", scriptList(hostHTML, "").join(", "));
ok(/bubble-glow\.css/.test(hostHTML) && /id="bubble-canvas"/.test(hostHTML), "bubble-host.html links the Glow CSS and has the canvas");
const previewPath = path.join(__dirname, "preview.html");
if (web === path.resolve(WEB) && fs.existsSync(previewPath)) {
  const list = scriptList(fs.readFileSync(previewPath, "utf8"), "../../FacebookClone/Bubbles/Runtime/web/");
  ok(JSON.stringify(list) === JSON.stringify(expected), "preview.html loads the same files in the same order", list.join(", "));
}

// Shared checks run inside the runtime's own context, like jsc does.
vm.runInContext(fs.readFileSync(path.join(__dirname, "checks.js"), "utf8"), context, { filename: "checks.js" });
const worldPath = path.join(seedsDir, "bubble-demo-world.json");
const result = context.BubbleRuntimeChecks.run({
  Bubble,
  seeds: seedFiles(seedsDir),
  world: fs.existsSync(worldPath) ? JSON.parse(fs.readFileSync(worldPath, "utf8")) : null,
  print: (s) => console.log(s),
  now,
  clock: "cpu",
  engine: "node",
  quick,
});
passed += result.passed;
failed += result.failed;
console.log("\nTotal: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
