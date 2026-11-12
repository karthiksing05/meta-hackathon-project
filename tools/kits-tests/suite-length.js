// Kit test suite: length modes (docs/BUBBLES.md 7.9). Owner: the length feature.
// STUB from feat/base. Loaded by run-node.js and run-jsc.sh before kits-tests-core.js; registers
// itself on KitSuites. Fill in: for every formula, one run per supported mode (endless, rounds,
// timed, lives) that ends the way the mode says, and replays that reproduce it exactly.
var KitSuites = (typeof KitSuites !== "undefined" ? KitSuites : []).concat([{
  name: "length",
  run: function (env) {
    var cat = env.Bubble.catalog();
    env.ok("length modes listed: " + (cat.length_modes || []).join(", "));
  }
}]);
