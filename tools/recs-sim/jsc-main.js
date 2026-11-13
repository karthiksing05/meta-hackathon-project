// JavaScriptCore entry for run-jsc.sh: game-recs.js and checks.js are already loaded.
(function () {
  var passed = 0, failed = 0;
  function ok(cond, name, detail) {
    if (cond) passed++;
    else { failed++; print("  FAIL " + name + (detail !== undefined ? ": " + detail : "")); }
  }
  print("Game recommender checks (JavaScriptCore, recs " + GameRecs.version + ")");
  runRecsChecks(GameRecs, ok);
  runBlendChecks(GameRecs, ok);
  runInterleaveChecks(GameRecs, ok);
  runMuseChecks(GameRecs, ok);
  print(passed + " passed, " + failed + " failed");
  if (failed) throw new Error(failed + " checks failed");
})();
