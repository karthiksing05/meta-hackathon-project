// STUB runtime: replaced by the real Bubble runtime. Implements just enough of the contract in
// docs/BUBBLES.md (section 4.3) for UI work: boot, tap-to-score for 8 seconds, then a result.
(function () {
  "use strict";
  const g = typeof globalThis !== "undefined" ? globalThis : this;

  function post(message) {
    try {
      g.webkit.messageHandlers.bubble.postMessage(message);
    } catch (e) {
      /* not in WKWebView */
    }
  }

  g.Bubble = {
    version: "0.0-stub",
    catalogJSON: function () { return "[]"; },
    validateJSON: function () { return JSON.stringify({ ok: true, errors: [], warnings: ["stub runtime"] }); },
    simulateJSON: function () {
      return JSON.stringify({ ok: true, error: null, outcome: "fail", score: 0, ticks: 0, duration_sec: 0, events: {}, replay: null });
    },
  };

  let state = null;

  function render() {
    const root = document.getElementById("bubble-root");
    if (!root || !state) return;
    const m = state.manifest || {};
    root.innerHTML =
      '<div class="stub-card"><div class="stub-title"></div><div class="stub-rule"></div><div class="stub-score"></div></div>';
    root.querySelector(".stub-title").textContent = m.title || "Bubble";
    root.querySelector(".stub-rule").textContent = m.one_line_rule || "";
    root.querySelector(".stub-score").textContent = String(state.score);
  }

  function finish() {
    if (!state || state.done) return;
    state.done = true;
    post({ type: "phase", name: "result" });
    post({
      type: "result",
      outcome: "fail",
      score: state.score,
      duration_sec: 8,
      replay: { seed: (state.manifest && state.manifest.seed) || 1, tick_rate: 60, total_ticks: 480, inputs: state.inputs },
      share: { headline: (state.manifest && state.manifest.title) || "Bubble", score_text: state.score + " pops" },
    });
  }

  g.BubbleHost = {
    boot: function (payloadJSON) {
      const payload = typeof payloadJSON === "string" ? JSON.parse(payloadJSON) : payloadJSON;
      state = { manifest: payload.manifest, mode: payload.mode, score: 0, inputs: [], start: Date.now(), done: false };
      render();
      post({ type: "ready", title: state.manifest && state.manifest.title });
      post({ type: "phase", name: state.mode === "play" ? "playing" : "intro" });
      if (state.mode === "play") setTimeout(finish, 8000);
    },
    command: function (cmd) {
      if (cmd && cmd.type === "restart" && state) {
        g.BubbleHost.boot(JSON.stringify({ manifest: state.manifest, mode: "play" }));
      }
    },
  };

  document.addEventListener("pointerdown", function () {
    if (!state || state.done) return;
    if (state.mode !== "play") {
      post({ type: "takeover" });
      g.BubbleHost.boot(JSON.stringify({ manifest: state.manifest, mode: "play" }));
      return;
    }
    state.score += 1;
    state.inputs.push({ t: Math.round(((Date.now() - state.start) / 1000) * 60), a: "tap" });
    post({ type: "score", value: state.score });
    post({ type: "haptic", style: "light" });
    render();
  });
})();
