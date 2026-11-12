// Kit test suite: length modes (docs/BUBBLES.md 7.9). Owner: the length feature.
// Loaded by run-node.js and run-jsc.sh before kits-tests-core.js; registers itself on KitSuites.
//
// For every formula with a length declaration, every example and seed of it, and every mode it
// supports, bot runs at three skills must:
//   - end the way the mode says: timed at seconds x 60 ticks (plus the end delay), rounds after
//     N length.round events, lives after N length.life events, never past those bounds; at least
//     one run per mode reaches its bound (the strict check, for the six original kits);
//   - replay exactly, both with the locked manifest and from a replay that carries the length on a
//     manifest that doesn't (a replay is self-describing);
//   - for a formula whose default is endless, a locked endless run equals today's unlocked run.
// story, nextline and learn are built in parallel: their runs must replay and not error, and the
// strict checks apply once their kits call lengthRound/lengthMiss.
var KitSuites = (typeof KitSuites !== "undefined" ? KitSuites : []).concat([{
  name: "length",
  run: function (env) {
    var B = env.Bubble;
    var STRICT = ["dodge", "time", "merge", "guess", "group", "answer"];
    var NUMBERS = { rounds: 6, seconds: 20, lives: 2 };
    // A word is usually found in 3-5 tries and 10-20 s: shorter limits so bots reach them.
    var NUMBERS_BY_FORMULA = { guess: { rounds: 3, seconds: 10, lives: 2 } };
    var MAX_TICKS = 150 * 60;
    var END_SLACK = 150; // the longest end delay a kit uses (a reveal, a settling jar)
    var skills = env.quick ? [0.15, 0.95] : [0.15, 0.6, 0.95];
    var cat = B.catalog();
    env.print("  length modes: " + (cat.length_modes || []).join(", "));

    function key(r) { return [r.outcome, r.score, r.ticks, JSON.stringify(r.events)].join("|"); }
    function lengthFor(mode, fid) {
      var n = NUMBERS_BY_FORMULA[fid] || NUMBERS;
      var L = { mode: mode };
      if (mode === "rounds") L.rounds = n.rounds;
      if (mode === "timed") L.seconds = n.seconds;
      if (mode === "lives") L.lives = n.lives;
      return L;
    }
    function copy(v) { return JSON.parse(JSON.stringify(v)); }

    // Every example of every declared formula, plus the seeds.
    var list = [];
    cat.formulas.forEach(function (f) {
      if (!f.length || !Array.isArray(f.length.modes)) { env.print("  " + f.id + ": no length declaration"); return; }
      var exs = Array.isArray(f.examples) && f.examples.length ? f.examples : f.example ? [f.example] : [];
      exs.forEach(function (ex) { list.push({ name: "example:" + ex.id, manifest: ex, formula: f }); });
    });
    (env.manifests || []).forEach(function (x) {
      if (!x.seed || !x.valid) return;
      var f = cat.formulas.filter(function (ff) { return ff.id === x.manifest.formula; })[0];
      if (f && f.length) list.push({ name: x.name, manifest: x.manifest, formula: f });
    });

    var checked = 0, strictHits = {};
    list.forEach(function (item) {
      var f = item.formula, strict = STRICT.indexOf(f.id) >= 0;
      var plain = item.manifest;
      var N = NUMBERS_BY_FORMULA[f.id] || NUMBERS;
      // Today's run is endless when the manifest's own length (no rule.timer, rounds or lives) is.
      var todayEndless = (B.displayLength(plain) || {}).mode === "endless";
      f.length.modes.forEach(function (mode) {
        var where = item.name + " [" + mode + "]";
        var locked = copy(plain);
        locked.length = lengthFor(mode, f.id);
        var v = B.validate(locked);
        if (!v.ok) { env.fail(where + ": doesn't validate: " + v.errors.map(function (e) { return e.message; }).join("; ")); return; }
        var reached = false;
        skills.forEach(function (skill, i) {
          var o = { bot_seed: 101 + i * 31, bot_skill: skill, max_ticks: MAX_TICKS };
          var r = B.simulate(locked, o);
          var at = where + " skill " + skill;
          if (!r.ok) { env.fail(at + ": " + r.error); return; }
          checked++;
          var rounds = r.events["length.round"] || 0, lives = r.events["length.life"] || 0;
          // Replays: the locked manifest, and the plain manifest with a self-describing replay.
          if (!r.replay || !r.replay.length || r.replay.length.mode !== mode) env.fail(at + ": the replay doesn't record the length");
          var a = B.simulate(locked, { replay: r.replay, max_ticks: MAX_TICKS });
          if (key(a) !== key(r)) env.fail(at + ": replay differs (" + key(a) + " vs " + key(r) + ")");
          var b = B.simulate(plain, { replay: r.replay, max_ticks: MAX_TICKS });
          if (key(b) !== key(r)) env.fail(at + ": replay on the plain manifest differs (" + key(b) + " vs " + key(r) + ")");
          if (!strict) return;
          if (mode === "timed") {
            var limit = N.seconds * 60;
            if (r.ticks > limit + END_SLACK) env.fail(at + ": timed run went " + r.ticks + " ticks (limit " + limit + ")");
            if (r.outcome === "timeout") env.fail(at + ": timed run timed out");
            if (r.ticks >= limit) reached = true;
          } else if (mode === "rounds") {
            if (rounds > N.rounds) env.fail(at + ": " + rounds + " rounds (limit " + N.rounds + ")");
            if (rounds === N.rounds) {
              reached = true;
              if (r.outcome === "timeout") env.fail(at + ": rounds used up but the run didn't end");
              if (!r.events["length.end"]) env.fail(at + ": rounds used up without length.end");
            }
          } else if (mode === "lives") {
            if (lives > N.lives) env.fail(at + ": " + lives + " lives lost (has " + N.lives + ")");
            if (lives === N.lives) {
              reached = true;
              if (r.outcome !== "fail") env.fail(at + ": out of lives but outcome " + r.outcome);
            }
          } else if (mode === "endless") {
            // At least one bot (usually a weak one) must end an endless run.
            if (r.outcome !== "timeout") reached = true;
            if (todayEndless) {
              var today = B.simulate(plain, o);
              if (key(today) !== key(r)) env.fail(at + ": locked endless differs from today's run (" + key(r) + " vs " + key(today) + ")");
            }
          }
        });
        if (strict && !reached) env.fail(where + ": no bot run " + (mode === "endless" ? "ended" : "reached the " + mode + " limit"));
        if (strict) strictHits[f.id + ":" + mode] = true;
      });
    });
    // Every original kit honors every mode it declares.
    cat.formulas.forEach(function (f) {
      if (STRICT.indexOf(f.id) < 0) return;
      if (!f.length) { env.fail(f.id + ": no length declaration"); return; }
      f.length.modes.forEach(function (mode) { if (!strictHits[f.id + ":" + mode]) env.fail(f.id + ": mode " + mode + " never tested"); });
    });
    env.print("  " + checked + " length runs across " + list.length + " manifests, each replayed twice");
    if (env.report) env.report.length = { runs: checked, manifests: list.length };
  }
}]);
