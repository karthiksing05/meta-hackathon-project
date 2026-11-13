#!/usr/bin/env node
"use strict";
// The renderer's text safety net (engine/web/render.js fitText, docs/BUBBLES.md "microgame"): text
// that would cross its box or the canvas's 12-unit margin is re-wrapped at spaces, shrunk to 70 %,
// then ellipsized, and the block is kept on the canvas. A fixed-width fake font (0.5 × size per
// character) stands in for measureText.
//   node tools/runtime-tests/microgame-text-fit.js
const { load } = require("./load.js");

const env = load();
const ME = env.context.MicrogameEngine;
const { fitText, TEXT_MARGIN } = ME;
let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log("  FAIL " + name + (detail ? ": " + detail : "")); }
}
const W = 360, H = 640, M = TEXT_MARGIN;
const op = (o) => Object.assign({ x: 0, y: 100, w: 200, h: 25, size: 20, line_height: 25, align: "center", valign: "middle", text: "" }, o);
const fake = (size) => (line) => line.length * size * 0.5;
const ink = (o, r) => {
  const lw = Math.max(0, ...r.lines.map((l) => fake(o.size)(l) * (r.size / o.size)));
  const left = o.align === "left" ? r.x : o.align === "right" ? r.x - lw : r.x - lw / 2;
  return { x0: left, x1: left + lw, y0: r.y - r.lh / 2, y1: r.y + r.lh * (r.lines.length - 0.5) };
};
const inside = (b, o, r) => b.x0 >= M - 0.01 && b.x1 <= W - M + 0.01 && (!(o.w > 0) || b.x1 - b.x0 <= o.w + 0.6);
console.log("Text fit (engine/web/render.js fitText)");

{ // 1. Text that fits is drawn as it is.
  const o = op({ x: 80, text: "Score 120" });
  const r = fitText(o, fake(o.size), W, H);
  ok(!r.changed && r.lines.join("|") === "Score 120" && r.size === 20, "fits: unchanged", JSON.stringify(r));
}
{ // 2. Wraps at spaces within the box's lines.
  const o = op({ x: 80, h: 50, text: "Tap the glowing cookie fast" });
  const r = fitText(o, fake(o.size), W, H);
  ok(r.size === 20 && r.lines.length === 2 && !r.truncated, "wraps within two box lines", JSON.stringify(r.lines));
  ok(inside(ink(o, r), o, r), "wrapped lines inside the box");
}
{ // 3. One-line box: shrinks (not below 70 %).
  const o = op({ x: 80, text: "Tap the cookies!!!!" }); // 19 chars × 10 = 190 at 20 … but 200 wide box: fits
  const o2 = op({ x: 80, text: "Tap the cookies now!!" }); // 21 chars → 210 > 200
  const r = fitText(o2, fake(o2.size), W, H);
  ok(r.size < 20 && r.size >= 14 - 1e-9 && r.lines.length === 1 && !r.truncated, "shrinks a one-line label", JSON.stringify(r));
  ok(!fitText(o, fake(o.size), W, H).changed, "a label that just fits stays");
}
{ // 4. Last resort: ellipsis.
  const o = op({ x: 80, text: "Supercalifragilisticexpialidocious-and-then-some-more-words" });
  const r = fitText(o, fake(o.size), W, H);
  ok(r.truncated && r.lines.length === 1 && /…$/.test(r.lines[0]) && Math.abs(r.size - 14) < 1e-6, "ellipsizes at 70 %", JSON.stringify(r));
  ok(inside(ink(o, r), o, r), "ellipsized line inside the box");
}
{ // 5. A box wider than the canvas: held to the canvas margin.
  const o = op({ x: -40, w: 440, text: "This line is far too long for any phone screen at all, really" });
  const r = fitText(o, fake(o.size), W, H);
  const b = ink(o, r);
  ok(b.x0 >= M - 0.01 && b.x1 <= W - M + 0.01, "held inside the canvas margin", JSON.stringify(b));
}
{ // 6. Left-aligned text at the edge is moved inside the margin.
  const o = op({ x: 2, w: 100, align: "left", text: "Lives 3" });
  const r = fitText(o, fake(o.size), W, H);
  ok(r.x >= M - 0.01, "moved off the left edge", JSON.stringify(r));
  const o2 = op({ x: 300, w: 58, align: "right", text: "999" });
  const r2 = fitText(o2, fake(o2.size), W, H);
  ok(r2.x <= W - M + 0.01, "moved off the right edge", JSON.stringify(r2));
}
{ // 7. Off-canvas text (sliding in) keeps its place.
  const o = op({ x: -400, text: "Round 2" });
  const r = fitText(o, fake(o.size), W, H);
  ok(!r.changed && r.x === o.x + o.w / 2, "off-canvas text keeps its place");
}
{ // 8. Vertical: a label at the very top is moved down inside the margin.
  const o = op({ x: 80, y: -4, text: "Top" });
  const r = fitText(o, fake(o.size), W, H);
  ok(r.y - r.size / 2 >= M - 0.01, "moved below the top margin", JSON.stringify(r));
}
{ // 9. drawFrame draws through the fit: a fake 2D context records fillText calls.
  const calls = [];
  const ctx = {
    canvas: { width: W, height: H }, font: "", measureText: (s) => ({ width: s.length * 10 }),
    save() {}, restore() {}, setTransform() {}, clearRect() {}, translate() {}, scale() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
    fillText: (s, x, y) => calls.push({ s, x, y }), strokeText() {},
  };
  const frame = { width: W, height: H, background: 0, shake: 0, ops: [{ op: "text", x: 300, y: 50, w: 200, h: 25, size: 20, line_height: 25, align: "center", valign: "middle", text: "Way too long a label for this", color: 0xffffffff, stroke: 0, stroke_width: 0, weight: 700, font: "", opacity: 1, scale: 1, rotation: 0 }] };
  ME.drawFrame(ctx, frame, null);
  const c = calls[0];
  ok(calls.length >= 1 && calls.every((k) => k.x - (k.s.length * 10 * (1)) / 2 >= -1), "drawFrame drew text", JSON.stringify(calls));
  ok(c && c.x + (c.s.length * 10) / 2 <= W - M + 0.5 + 1e-6 || (c && /…/.test(c.s)), "drawn line ends inside the right margin", JSON.stringify(calls));
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
