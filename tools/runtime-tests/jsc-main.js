// jsc-main.js: entry point for run-jsc.sh. Runs after the runtime files and checks.js in one
// JavaScriptCore global (no DOM, no console). Arguments after "--": the demo world path, then seeds.
var jscArgs = typeof arguments !== "undefined" ? Array.prototype.slice.call(arguments) : [];
(function (args) {
  "use strict";
  function baseName(p) { return p.split("/").pop(); }
  var worldPath = args[0];
  var seeds = args.slice(1).map(function (p) { return { name: baseName(p), json: readFile(p) }; });
  var world = null;
  try { world = JSON.parse(readFile(worldPath)); } catch (e) { world = null; }
  print("Bubble runtime tests (JavaScriptCore)");
  print("\nLoading with no DOM");
  var noDOM = typeof document === "undefined" && typeof window === "undefined" && typeof BubbleHost === "undefined";
  print(noDOM ? "  ok: Bubble " + Bubble.version + " loaded, no DOM globals, no BubbleHost" : "  FAIL a DOM global or BubbleHost appeared");
  var now = typeof preciseTime === "function" ? function () { return preciseTime() * 1000; } : function () { return Date.now(); };
  var result = BubbleRuntimeChecks.run({ Bubble: Bubble, seeds: seeds, world: world, print: print, now: now, clock: "wall", engine: "jsc", quick: true });
  var failed = result.failed + (noDOM ? 0 : 1);
  print("\nTotal: " + (result.passed + (noDOM ? 1 : 0)) + " passed, " + failed + " failed");
  // jsc's quit() ignores its exit code; an uncaught exception exits with status 3.
  if (failed) throw new Error(failed + " check(s) failed");
})(jscArgs);
