// Entry point for run-jsc.sh: runs the kit tests in one JavaScriptCore global (no DOM, no console).
// Arguments after "--": [--quick] [--formula a,b] --seeds <seed files...>
var jscArgs = typeof arguments !== "undefined" ? Array.prototype.slice.call(arguments) : [];
(function (args) {
  "use strict";
  var i = args.indexOf("--seeds");
  var seeds = i >= 0 ? args.slice(i + 1) : [];
  var opts = i >= 0 ? args.slice(0, i) : args;
  var fi = opts.indexOf("--formula");
  var formulas = fi >= 0 ? String(opts[fi + 1]).split(",") : undefined;
  var now = typeof preciseTime === "function" ? function () { return preciseTime() * 1000; } : function () { return Date.now(); };
  var noDOM = typeof document === "undefined" && typeof window === "undefined";
  print("JavaScriptCore (jsc) · real runtime " + Bubble.version + (noDOM ? " · no DOM" : " · DOM globals present?!"));
  var t0 = now();
  var result = KitTests.run({
    print: print,
    readText: function (p) { return readFile(p); },
    seeds: seeds,
    quick: opts.indexOf("--quick") >= 0,
    verbose: opts.indexOf("--verbose") >= 0,
    formulas: formulas
  });
  print("(" + ((now() - t0) / 1000).toFixed(1) + " s)");
  // jsc's quit() ignores its exit code; an uncaught exception exits with status 3.
  if (result.failures.length || !noDOM) throw new Error(result.failures.length + " kit test(s) failed");
})(jscArgs);
