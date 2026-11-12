// Kit test suite: same-seed challenges (docs/BUBBLES.md 7.2). Owner: the challenge feature.
// Loaded by run-node.js and run-jsc.sh before kits-tests-core.js; registers itself on KitSuites.
//
// Challenge Me and group-chat sessions play a Bubble on a card's seed (not the Bubble's own), and
// friends' sides are bot runs at skill 0.95, 0.85 or 0.7 (the app picks the one closest above
// your score). For one seeded Bubble per formula, on a challenge seed and a rematch seed, this
// checks that:
//   - every bot run's replay records the card's seed,
//   - the replay re-simulates to exactly the same score (so friends' scores are verifiable),
//   - the same bot on the same seed scores the same (so the app's skill pick is stable).
// It also notes (without failing) formulas where all three skills score the same, since then the
// app's "closest above yours" pick has nothing to choose from.
var KitSuites = (typeof KitSuites !== "undefined" ? KitSuites : []).concat([{
  name: "challenge",
  run: function (env) {
    var Bubble = env.Bubble;
    var seen = {};
    var picked = env.manifests.filter(function (x) {
      if (!x.valid || !x.seed) return false;
      var formula = x.manifest.formula;
      if (env.wanted.indexOf(formula) < 0 || seen[formula]) return false;
      seen[formula] = true;
      return true;
    });
    if (env.quick) picked = picked.slice(0, 3);
    var skills = [0.95, 0.85, 0.7];
    var checked = 0;
    picked.forEach(function (x) {
      var json = JSON.stringify(x.manifest);
      // A challenge seed and a rematch seed, like ChallengeCenter makes them.
      var seeds = [x.manifest.seed + 7919, 1000 + ((x.manifest.seed * 31 + 17) % 900000)];
      var spread = {};
      seeds.forEach(function (seed) {
        skills.forEach(function (skill) {
          var options = { seed: seed, max_ticks: 60 * 150, bot: true, bot_seed: 4242, bot_skill: skill };
          var r = JSON.parse(Bubble.simulateJSON(json, JSON.stringify(options)));
          var label = x.name + " seed " + seed + " skill " + skill;
          if (!r.ok) { env.fail(label + ": simulate failed: " + (r.error || "")); return; }
          if (!r.replay || r.replay.seed !== seed) {
            env.fail(label + ": replay seed " + (r.replay && r.replay.seed) + " is not the card's seed");
            return;
          }
          var again = JSON.parse(Bubble.simulateJSON(json, JSON.stringify({ seed: r.replay.seed, max_ticks: r.ticks + 120, bot: false, replay: r.replay })));
          if (!again.ok || again.score !== r.score) {
            env.fail(label + ": replay scored " + again.score + ", run scored " + r.score);
            return;
          }
          var twin = JSON.parse(Bubble.simulateJSON(json, JSON.stringify(options)));
          if (twin.score !== r.score) {
            env.fail(label + ": same bot scored " + twin.score + " then " + r.score);
            return;
          }
          spread[r.score] = true;
          checked++;
        });
      });
      if (Object.keys(spread).length < 2) {
        env.print("  note " + x.name + ": skills 0.95, 0.85 and 0.7 score the same on both challenge seeds");
      }
    });
    env.ok("challenge: " + checked + " same-seed bot runs replay exactly across " + picked.length + " formulas");
  }
}]);
