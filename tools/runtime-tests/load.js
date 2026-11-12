// Loads the Bubble runtime in Node with no DOM, exactly like JavaScriptCore does: a fresh context,
// the files in the doc's order (bubble-runtime.js, bubble-kit-common.js, then the other kits by name).
//
//   const { load } = require("./load");
//   const { Bubble, files } = load();            // FacebookClone/Bubbles/Runtime/web
//   const { Bubble } = load("/path/to/web");     // another copy (e.g. a kits workspace)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const WEB = path.join(ROOT, "FacebookClone", "Bubbles", "Runtime", "web");
const SEEDS = path.join(ROOT, "FacebookClone", "Bubbles", "Seeds");

// Same rule as BubbleJSRuntime.orderedScriptNames in Swift.
function orderedScriptNames(names) {
  const kits = names.filter((n) => n.startsWith("bubble-kit-") && n.endsWith(".js") && n !== "bubble-kit-common.js").sort();
  const out = ["bubble-runtime.js"];
  if (names.includes("bubble-kit-common.js")) out.push("bubble-kit-common.js");
  return out.concat(kits);
}

function load(dir, options) {
  dir = dir || WEB;
  const quiet = !options || options.quiet !== false;
  const files = orderedScriptNames(fs.readdirSync(dir).filter((n) => n.endsWith(".js")));
  const logs = [];
  const sandbox = {
    console: {
      log: (...a) => { logs.push(a.join(" ")); if (!quiet) console.log(...a); },
      info: (...a) => logs.push(a.join(" ")),
      warn: (...a) => logs.push(a.join(" ")),
      error: (...a) => logs.push(a.join(" ")),
      debug: () => {},
    },
  };
  const ctx = vm.createContext(sandbox);
  const t0 = process.hrtime.bigint();
  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(dir, name), "utf8"), ctx, { filename: name });
  }
  const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (typeof ctx.Bubble !== "object") throw new Error("Bubble is not defined after loading " + files.join(", "));
  if (typeof ctx.document !== "undefined" || typeof ctx.window !== "undefined") throw new Error("A runtime file created a DOM global");
  return { Bubble: ctx.Bubble, BubbleHost: ctx.BubbleHost, files, logs, loadMs, context: ctx };
}

function seedFiles(dir) {
  dir = dir || SEEDS;
  return fs.readdirSync(dir)
    .filter((n) => n.startsWith("bubble-seed-") && n.endsWith(".json"))
    .sort()
    .map((n) => ({ name: n, path: path.join(dir, n), json: fs.readFileSync(path.join(dir, n), "utf8") }));
}

module.exports = { load, seedFiles, orderedScriptNames, ROOT, WEB, SEEDS };
