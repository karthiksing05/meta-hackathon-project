// A bot for typed-answer microgames (the playtest bots sample 12 strings and rarely type a right answer). At each open
// prompt it tries every string in the game's state on a fork, keeps the ones that raise the score, and submits one by
// its skill: the best answer with probability `skill`, otherwise a lesser right answer or, now and then, a miss. The
// run is a real engine run, so its input log replays on the server like any other.

import { loadBots } from '../demo-seed/bots.mjs';

function strings(v, out, depth = 0) {
  if (out.size >= 1500 || depth > 6 || v == null) return;
  if (typeof v === 'string') { // answer lists are often packed as "a=alias,b|c" strings: their pieces are candidates too
    for (const w of [v, ...v.split(/[|,=]/)].map((x) => x.trim())) if (w && w.length <= 28 && !w.includes('\n')) out.add(w);
  }
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, depth + 1));
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('__')) strings(x, out, depth + 1);
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function textRun(gameText, { seed, skill, botSeed, maxSeconds = 220 }) {
  const { engine, bots: B } = loadBots();
  const rng = mulberry32(botSeed);
  const DT = B.DT;
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  let g;
  try {
    g = engine.load(gameText, seed);
    const pool = new Set();
    strings(B.asObject(g.state()), pool);
    const cands = [...pool];
    if (process.env.FW_DEBUG) console.log('candidates', cands.length, cands.slice(0, 8));
    const used = new Set();
    let steps = 0, next = 30;
    while (steps < maxSteps && g.phase() === 'playing') {
      if (steps >= next) {
        const val = (x) => { let st = {}; try { st = B.asObject(x.state()) ?? {}; } catch { /* none */ } return (x.status().score ?? 0) + (Number(st.ta_points) || 0) + (Number(st.right_count) || 0) * 0.5; };
        const base = val(g);
        const right = [];
        for (const c of cands) {
          if (used.has(c.toLowerCase())) continue;
          const p = g.fork();
          try {
            p.text('submit', c);
            for (let i = 0; i < 3; i++) p.step(DT);
            const d = val(p) - base;
            if (d > 0) right.push({ c, d });
          } finally { p.dispose(); }
        }
        if (right.length) {
          right.sort((a, b) => b.d - a.d);
          let pick;
          const r = rng();
          if (r < skill) pick = right[0];
          else if (r < skill + (1 - skill) * 0.75) pick = right[Math.floor(rng() * right.length)];
          else pick = { c: cands[Math.floor(rng() * cands.length)] }; // a miss (or a lucky guess)
          used.add(pick.c.toLowerCase());
          g.text('change', pick.c);
          g.text('submit', pick.c);
          g.text('change', '');
          next = steps + Math.round((pick.c.length * 250 + 300) / DT) + 60 + Math.round(rng() * 180); // reveal, then think
        } else {
          next = steps + 20;
        }
      }
      g.step(DT);
      steps++;
    }
    const st = g.status();
    return { phase: st.phase, score: Math.round(st.score ?? 0), timeMs: Math.round(st.time_ms ?? 0), seconds: (st.time_ms ?? 0) / 1000, log: JSON.stringify(g.log()) };
  } catch (e) {
    return null;
  } finally {
    try { g?.dispose(); } catch { /* ignore */ }
  }
}
