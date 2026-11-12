// Kit test suite: learn (docs/BUBBLES.md 7.8). Owner: the learn feature.
// Loaded by run-node.js and run-jsc.sh before kits-tests-core.js; registers itself on KitSuites.
//
// Checks, on the learn example and every learn seed:
//   - content: every answer index is in range and each question's choices are distinct;
//   - an explanation shows after every answer, right and wrong (event counts);
//   - the share tag's mastery matches the right/asked event counts, and replays reproduce it;
//   - length: rounds plays exactly N questions; lives ends after the lives run out (3 by
//     default; the engine's count once the length feature lands); endless ends at the first
//     miss; sdk.length resolves for every mode.
var KitSuites = (typeof KitSuites !== "undefined" ? KitSuites : []).concat([{
  name: "learn",
  run: function (env) {
    var Bubble = env.Bubble, fail = env.fail, ok = env.ok, print = env.print;
    if (env.wanted.indexOf("learn") < 0) return;
    var list = env.manifests.filter(function (x) { return x.valid && x.manifest.formula === "learn"; });
    if (!list.length) { fail("learn: no valid learn manifests to test"); return; }

    function sim(m, opts) {
      return JSON.parse(Bubble.simulateJSON(JSON.stringify(m), JSON.stringify(opts)));
    }
    function withLength(m, length) {
      var c = JSON.parse(JSON.stringify(m));
      c.length = length;
      return c;
    }
    function tagOf(r) {
      var out = {};
      var tag = r && r.share && r.share.tag;
      if (!tag) return out;
      tag.split(";").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1); });
      return out;
    }
    function ev(r, name) { return (r.events && r.events[name]) || 0; }

    var formula = null;
    JSON.parse(Bubble.catalogJSON()).formulas.forEach(function (f) { if (f.id === "learn") formula = f; });
    if (!formula || !formula.length) fail("learn: formula has no length declaration");
    else if (["rounds", "lives", "endless"].some(function (mode) { return (formula.length.modes || []).indexOf(mode) < 0; })) fail("learn: length modes must include rounds, lives and endless");

    var checked = 0;
    list.forEach(function (x) {
      var m = x.manifest, name = x.name;
      var qs = (m.content && m.content.questions) || [];
      var points = (m.content && m.content.lesson && m.content.lesson.points) || [];

      // Content.
      qs.forEach(function (q, i) {
        var n = (q.choices || []).length;
        if (!(q.answer >= 0 && q.answer < n)) fail(name + ": question " + i + " answer " + q.answer + " is out of range (" + n + " choices)");
        var seen = {};
        (q.choices || []).forEach(function (c) {
          var k = String(c).trim().toLowerCase();
          if (seen[k]) fail(name + ": question " + i + " repeats the choice \"" + c + "\"");
          seen[k] = true;
        });
        if (!q.explain) fail(name + ": question " + i + " has no explanation");
        if (typeof q.point === "number" && (q.point < 0 || q.point >= points.length)) fail(name + ": question " + i + " points at a missing lesson point " + q.point);
      });

      // Explanations after right and wrong answers; mastery tag; replays reproduce mastery.
      var sawRight = false, sawWrong = false;
      [0.15, 0.5, 0.95].forEach(function (skill, si) {
        for (var b = 1; b <= (env.quick ? 2 : 4); b++) {
          var r = sim(m, { seed: m.seed, max_ticks: 60 * 150, bot: true, bot_seed: 4000 + si * 97 + b, bot_skill: skill });
          if (!r.ok) { fail(name + ": sim error " + r.error); continue; }
          var answers = ev(r, "learn.answer"), rights = ev(r, "learn.right"), wrongs = ev(r, "learn.wrong");
          if (ev(r, "learn.lesson_done") !== 1) fail(name + ": the lesson card should show once before practice");
          if (ev(r, "learn.explain") !== answers) fail(name + ": " + ev(r, "learn.explain") + " explanations for " + answers + " answers");
          if (rights + wrongs !== answers) fail(name + ": right + wrong != answers");
          if (ev(r, "learn.recap") !== 1) fail(name + ": no recap");
          if (rights) sawRight = true;
          if (wrongs) sawWrong = true;
          var tag = tagOf(r);
          if (tag.mastery !== rights + "/" + answers) fail(name + ": tag mastery " + tag.mastery + " vs events " + rights + "/" + answers);
          if (!tag.topic) fail(name + ": tag has no topic");
          if (wrongs && !tag.miss) fail(name + ": wrong answers but no miss list in the tag");
          if (answers !== qs.length) fail(name + ": rounds default should ask every question once (asked " + answers + " of " + qs.length + ")");
          if (b === 1) {
            var again = sim(m, { seed: r.replay.seed, max_ticks: r.ticks + 120, bot: false, replay: r.replay });
            if (!again.ok || (again.share && again.share.tag) !== (r.share && r.share.tag) || again.score !== r.score) {
              fail(name + ": replay changed mastery (" + (r.share && r.share.tag) + " vs " + (again.share && again.share.tag) + ")");
            }
          }
        }
      });
      if (!sawRight || !sawWrong) fail(name + ": bot runs should include both right and wrong answers (explanations after both)");

      // Length modes.
      ["rounds", "lives", "endless"].forEach(function (mode) {
        var resolved = Bubble.resolveLength(withLength(m, { mode: mode }), formula);
        if (!resolved || resolved.mode !== mode) fail(name + ": sdk.length doesn't resolve " + mode);
      });
      var four = sim(withLength(m, { mode: "rounds", rounds: 4 }), { seed: m.seed, max_ticks: 60 * 150, bot: true, bot_seed: 77, bot_skill: 0.7 });
      if (!four.ok || ev(four, "learn.answer") !== 4) fail(name + ": rounds 4 asked " + ev(four, "learn.answer") + " questions");
      else if (!(four.share && /(^|;)mastery=\d+\/4(;|$)/.test(four.share.tag || "")) || ev(four, "learn.recap") !== 1) fail(name + ": rounds 4 should end on the recap with a mastery tag (" + (four.share && four.share.tag) + ")");
      var livesRun = sim(withLength(m, { mode: "lives", lives: 3 }), { seed: m.seed, max_ticks: 60 * 300, bot: true, bot_seed: 78, bot_skill: 0 });
      if (!livesRun.ok || ev(livesRun, "learn.wrong") !== 3 || livesRun.outcome !== "fail") fail(name + ": lives 3 should end after 3 wrong answers (" + ev(livesRun, "learn.wrong") + " wrong, " + livesRun.outcome + ")");
      var lifeTwo = sim(withLength(m, { mode: "lives", lives: 2 }), { seed: m.seed, max_ticks: 60 * 300, bot: true, bot_seed: 79, bot_skill: 0 });
      if (!lifeTwo.ok || ev(lifeTwo, "learn.wrong") !== 2) fail(name + ": lives 2 should end after 2 wrong answers (" + ev(lifeTwo, "learn.wrong") + ")");
      var endless = sim(withLength(m, { mode: "endless" }), { seed: m.seed, max_ticks: 60 * 300, bot: true, bot_seed: 80, bot_skill: 0.5 });
      if (!endless.ok || endless.outcome === "timeout" || ev(endless, "learn.wrong") > 1) fail(name + ": endless should end at the first miss (" + ev(endless, "learn.wrong") + " wrong, " + endless.outcome + ")");
      var endlessReplay = sim(withLength(m, { mode: "endless" }), { seed: endless.replay.seed, max_ticks: endless.ticks + 120, bot: false, replay: endless.replay });
      if (endlessReplay.score !== endless.score || endlessReplay.ticks !== endless.ticks) fail(name + ": endless replay differs");
      checked++;
      ok(name + ": learn checks");
    });
    print("  learn: " + checked + " manifests checked (content, explanations, mastery tags, replays, rounds/lives/endless)");
  }
}]);
