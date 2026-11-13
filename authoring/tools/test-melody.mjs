#!/usr/bin/env node
// Tests for melody clips (expander/melody.mjs), the `sound.clips` section and the play_clip fragment.
//
//   node authoring/tools/test-melody.mjs
//
//   1. notation: parsing, durations, chords, drums and every error message;
//   2. rendering: same clip → same bytes (twice, and against pinned hashes), valid WAV headers,
//      8-bit above the hi-fi budget, never silent, never clipping past ±0.98;
//   3. JavaScriptCore (macOS, when jsc is installed): the same bytes as Node, since the renderer
//      uses no Math.sin/exp/random;
//   4. the expander: sound.clips becomes assets clip_0…, errors land at /sound/clips/<i>/…;
//   5. with a built engine (MG_ENGINE_DIR): Guess the Decade plays the right clip for each question,
//      Play again replays it (and is limited), and a run's state and score are identical with the
//      clips swapped for silence: audio is presentation only, so replays verify.
// Exit 1 on any failure.

import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClip, parseLine, parseChords, renderClip, compileClips, sin2pi, expD, STYLES, GROOVES, CLIP_LIMITS, CLIP_RATE } from '../expander/melody.mjs';
import { compileSound } from '../expander/sound.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
const fnv = (bytes) => { let h = 2166136261; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const msgs = (spec) => checkClip(spec).problems.map((p) => `${p.at} ${p.message}`).join(' | ');

const DEMO = { style: '80s', bpm: 112, bars: 2, lead: 'A4/8 C5 E5 A5/4 G5/8 E5 D5/4 C5/8 D5 E5/2', chords: 'Am F' };

// ---------------------------------------------------------------- 1. notation
console.log('notation');
{
  const l = parseLine('C5/8 E5 G5/4. r/16 B4/16 C6/1', 64);
  ok(!l.error && l.events.length === 5, 'reads notes, rests and carried durations', l);
  ok(l.events[1].len === 2 && l.events[2].len === 6 && l.events[3].at === 11 && l.events[4].len === 16, 'durations: /8 carries, dotted /4 is 6, a rest advances time', l.events);
  ok(parseLine('C5/2 D5/2 E5/2', 16).trimmed === true, 'a line past the clip end is trimmed');
  ok(/isn't a note/.test(parseLine('H5', 16).error), 'a bad note name is named');
  ok(/out of range/.test(parseLine('C0', 16).error), 'a note below C1 is out of range');
  ok(/duration/.test(parseLine('C5/3', 16).error), 'a bad duration is named');
  ok(/too short/.test(parseLine('C5/16.', 16).error), 'a dotted 16th is refused');
  const c = parseChords('Am F/2 G7/2 Cmaj7', 16, 64);
  ok(!c.error && c.chords.length === 4 && c.chords[1].len === 8 && c.chords[3].at === 32, 'chords: one per bar or with durations', c);
  ok(c.chords[2].tones.join() === '0,4,7,10' && c.chords[0].tones.join() === '0,3,7', 'chord qualities', c.chords);
  ok(/slash chords/.test(parseChords('C/E', 16, 64).error), 'slash chords are refused with a reason');
  ok(/knows/.test(parseChords('Cmaj13', 16, 64).error), 'an unknown chord quality lists the known ones');
  ok(checkClip(DEMO).problems.length === 0, 'the demo clip checks clean', msgs(DEMO));
  ok(/no style 'disco'/.test(msgs({ ...DEMO, style: 'disco' })), 'unknown style');
  ok(/bpm from/.test(msgs({ ...DEMO, bpm: 400 })), 'bpm range');
  ok(/under 10 s/.test(msgs({ ...DEMO, bars: 8, bpm: 60 })), 'clip length limit');
  ok(/has no 'tempo'/.test(msgs({ ...DEMO, tempo: 3 })), 'unknown field');
  ok(/needs a lead line, chords, or both/.test(msgs({ style: '80s' })), 'an empty clip');
  ok(/drums .* isn't a groove/.test(msgs({ ...DEMO, drums: 'polka' })), 'unknown groove');
  ok(/drums.kick is a string/.test(msgs({ ...DEMO, drums: { kick: 'x-x-' } })), 'bad drum line');
  ok(/no instrument 'kazoo'/.test(msgs({ ...DEMO, lead_sound: 'kazoo' })), 'unknown instrument');
  ok(checkClip({ ...DEMO, meter: 3, chords: 'Am F', drums: 'waltz' }).problems.length === 0, '3/4 with the waltz groove');
  ok(checkClip({ ...DEMO, bass: 'A2/4 E2 A2 E2 F2 C3 F2 C3', drums: { kick: 'x...', hat: 'x.x.x.x.x.x.x.x.' } }).problems.length === 0, 'explicit bass notes and a custom drum pattern');
}

// ---------------------------------------------------------------- 2. rendering
console.log('rendering');
{
  ok(Math.abs(sin2pi(0.125) - Math.SQRT1_2) < 1e-9 && Math.abs(sin2pi(0.75) + 1) < 1e-9 && Math.abs(sin2pi(-0.3) - Math.sin(-0.6 * Math.PI)) < 1e-9, 'polynomial sine');
  ok(Math.abs(expD(-3.7) / Math.exp(-3.7) - 1) < 1e-13 && Math.abs(expD(2.5) / Math.exp(2.5) - 1) < 1e-13, 'series exp');
  const a = renderClip(DEMO), b = renderClip(JSON.parse(JSON.stringify(DEMO)));
  ok(a.ok && b.ok && fnv(a.bytes) === fnv(b.bytes) && a.uri === b.uri, 'same clip → same bytes');
  const v = new DataView(a.bytes.buffer);
  const str = (o, n) => String.fromCharCode(...a.bytes.slice(o, o + n));
  ok(str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE' && v.getUint32(24, true) === CLIP_RATE && v.getUint16(34, true) === 16 && v.getUint32(40, true) === a.bytes.length - 44, 'a 16-bit mono WAV at 11,025 Hz');
  ok(a.ms === Math.round(2 * 16 * (15 / 112) * 1000), 'reports the clip length', a.ms);
  ok(fnv(renderClip({ ...DEMO, lead: 'A4/8 C5 E5 A5/4 G5/8 E5 D5/4 C5/8 D5 E5/4 r/4' }).bytes) !== fnv(a.bytes), 'a different clip → different bytes');
  // Every style renders, isn't silent and doesn't clip.
  const hashes = {};
  for (const style of Object.keys(STYLES)) {
    const r = renderClip({ ...DEMO, style, bpm: undefined });
    let peak = 0, sum = 0;
    const n = (r.bytes.length - 44) / 2;
    const dv = new DataView(r.bytes.buffer);
    for (let i = 0; i < n; i++) { const s = dv.getInt16(44 + 2 * i, true) / 32767; peak = Math.max(peak, Math.abs(s)); sum += s * s; }
    ok(r.ok && peak > 0.5 && peak <= 0.981 && Math.sqrt(sum / n) > 0.05, `style ${style} renders a clean, audible clip`, { peak, rms: Math.sqrt(sum / n) });
    hashes[style] = fnv(r.bytes);
  }
  ok(new Set(Object.values(hashes)).size === Object.keys(STYLES).length, 'every style sounds different (different bytes)');
  for (const g of Object.keys(GROOVES)) ok(renderClip({ ...DEMO, meter: g === 'waltz' ? 3 : 4, drums: g }).ok, `groove ${g} renders`);
  // Pinned bytes: a change here means every saved game's clips would sound different after a
  // rebuild. Update the pins only on purpose.
  const PINS = { demo: '94185c1c', styles_80s: 'f925d44d' };
  const pin = (name, got) => {
    if (PINS[name].startsWith('__')) { console.log(`  (pin ${name} not set: ${got})`); return; }
    ok(PINS[name] === got, `pinned bytes for ${name}`, got);
  };
  pin('demo', fnv(a.bytes));
  pin('styles_80s', hashes['80s']);
  // The hi-fi budget: past it, every clip is 8-bit.
  const errs = [];
  const few = compileClips([DEMO, DEMO], (...e) => errs.push(e));
  const many = compileClips(Array(9).fill({ ...DEMO, bars: 4 }), (...e) => errs.push(e));
  const bits = (uri) => new DataView(Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)).slice(0, 44), (c) => c.charCodeAt(0)).buffer).getUint16(34, true);
  ok(!errs.length && bits(few.assets.clip_0.sound) === 16 && bits(many.assets.clip_0.sound) === 8, 'under 30 s of clips: 16-bit; over: 8-bit', errs);
  ok(many.ms.length === 9 && many.longest_ms === Math.round(4 * 16 * (15 / 112) * 1000), 'clip lengths reported', many);
  const tooMany = []; compileClips(Array(13).fill(DEMO), (...e) => tooMany.push(e));
  ok(tooMany.some((e) => /at most 12 clips/.test(e[2])), 'at most 12 clips');
  const tooLong = []; compileClips(Array(12).fill({ ...DEMO, bars: 4, bpm: 100, lead: 'A4/1 C5 E5 A5' }), (...e) => tooLong.push(e));
  ok(tooLong.some((e) => /together/.test(e[2])), `the total length is capped at ${CLIP_LIMITS.total_seconds} s`);
}

// ---------------------------------------------------------------- 3. JavaScriptCore
console.log('JavaScriptCore');
{
  const jsc = process.env.JSC || '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc';
  if (!existsSync(jsc)) console.log('  (skipped: no jsc)');
  else {
    const dir = mkdtempSync(join(tmpdir(), 'melody-jsc-'));
    const probe = join(dir, 'probe.mjs');
    writeFileSync(probe, `import { renderClip, STYLES } from ${JSON.stringify(join(root, 'expander/melody.mjs'))};
const fnv = (b) => { let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const DEMO = ${JSON.stringify(DEMO)};
const out = {};
for (const style of Object.keys(STYLES)) out[style] = fnv(renderClip({ ...DEMO, style, bpm: undefined }).bytes);
print(JSON.stringify(out));`);
    let got = null;
    try { got = JSON.parse(execFileSync(jsc, ['-m', probe], { encoding: 'utf8' }).trim()); } catch (e) { console.log(`  (jsc failed: ${e.message.split('\n')[0]})`); }
    if (got) {
      const node = {};
      for (const style of Object.keys(STYLES)) node[style] = fnv(renderClip({ ...DEMO, style, bpm: undefined }).bytes);
      ok(JSON.stringify(got) === JSON.stringify(node), 'JavaScriptCore renders the same bytes as Node for every style', { jsc: got, node });
    }
  }
}

// ---------------------------------------------------------------- 4. expander
console.log('expander');
const lib = loadLibrary(root);
const gameFile = join(root, 'games/guess_the_decade.authoring.json');
const manifest = JSON.parse(readFileSync(gameFile, 'utf8'));
{
  const e = [];
  const s = compileSound({ set: 'soft', clips: [DEMO] }, (...x) => e.push(x));
  ok(!e.length && s.clips.assets.clip_0?.sound.startsWith('data:audio/wav;base64,'), 'sound.clips → clip_0', e);
  const e2 = [];
  compileSound({ clips: [{ ...DEMO, lead: 'C5/4 X9' }] }, (...x) => e2.push(x));
  ok(e2.length === 1 && e2[0][0] === 'A_SOUND_CLIP' && e2[0][1] === '/sound/clips/0/lead' && /X9/.test(e2[0][2]), 'a clip error points at the clip and names the token', e2);
  const r = expand(manifest, lib);
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  ok(!errors.length, 'Guess the Decade expands', errors);
  const ids = Object.keys(r.game.assets || {}).filter((k) => k.startsWith('clip_'));
  ok(ids.length === manifest.sound.clips.length, 'one asset per clip', ids);
  const fb = r.game.presentation.feedback.find((f) => f.do.some((a) => a.sound?.asset));
  ok(fb && /'clip_' \+ str\(event.clip\)/.test(fb.do[0].sound.asset), 'play_clip plays clip_<i> from the event', fb);
  const r2 = expand({ ...manifest, art: { ...manifest.art, sprites: { clip_0: { svg: "<svg viewBox='0 0 8 8'><rect width='8' height='8'/></svg>" } } } }, lib);
  ok(r2.diagnostics.some((d) => d.code === 'A_ART_FIELD' && /sound clip/.test(d.message)), 'a sprite named like a clip is refused');
  const size = JSON.stringify(r.game).length;
  ok(size < 1_000_000, `the expanded game stays under 1 MB (${(size / 1024).toFixed(0)} KB)`, size);
}

// ---------------------------------------------------------------- 5. engine
console.log('engine');
{
  let loadEngine;
  try { ({ loadEngine } = await import('../expander/engine.mjs')); await loadEngine(); } catch (e) { loadEngine = null; console.log(`  (engine checks skipped: ${e.message.split('\n')[0]})`); }
  if (loadEngine) {
    const { engine } = await loadEngine();
    const r = expand(manifest, lib);
    const text = JSON.stringify(r.game);
    const nameOf = Object.fromEntries((() => { const g = engine.load(text, 1); const a = g.assets(); g.dispose(); return a.map((x) => [x.id, x.name]); })());
    const samples = (f) => (f.audio || []).filter((s) => s.kind === 'sample').map((s) => nameOf[s.asset]);
    const playOnce = (seed, gameText, script) => {
      const g = engine.load(gameText, seed);
      const heard = [];
      let t = 0;
      for (const step of script) {
        // `tap`: the i-th full-width target from the top (the UI kit lays them out: the replay
        // button first, then the answer tiles).
        if (step.tap !== undefined) {
          g.frame();
          const t = g.hitTargets().filter((h) => h.w >= 200).sort((a, b) => a.y - b.y)[step.tap];
          g.pointer('down', t.x + t.w / 2, t.y + t.h / 2); g.pointer('up', t.x + t.w / 2, t.y + t.h / 2);
        }
        for (let i = 0; i < (step.wait || 0) / 50; i++) { g.step(50); t += 50; const f = g.frame(); for (const n of samples(f)) heard.push({ t, clip: n, qi: g.state().qi }); }
      }
      const out = { heard, status: g.status(), hash: g.stateHash(), state: g.state() };
      g.dispose();
      return out;
    };
    const answerY = (k) => 1 + k; // target index: 0 is the replay button
    // Wait for the first clip, replay twice (the third is refused), answer, wait for the next clip.
    const script = [
      { wait: 5600 }, // the first clip plays at 600 ms and lasts under 5 s
      { tap: 0, wait: 5000 },
      { tap: 0, wait: 5000 },
      { tap: 0, wait: 500 },
      { tap: answerY(0), wait: 2000 },
      { wait: 2000 },
    ];
    const run = playOnce(7, text, script);
    const first = run.heard[0];
    ok(first && first.t <= 700 + 50, 'the first clip starts ~600 ms in', run.heard);
    const g = engine.load(text, 7); g.step(700); const st = g.state(); g.dispose();
    ok(first && first.clip === `clip_${st.order[st.qi] % manifest.sound.clips.length}`, 'it is the clip of the question on screen', { first, order: st.order, qi: st.qi });
    const firstQ = run.heard.filter((h) => h.qi === first.qi);
    ok(firstQ.length === 3 && firstQ.every((h) => h.clip === first.clip), 'Play again replays the same clip twice, and a third tap is refused', run.heard);
    const next = run.heard.find((h) => h.qi !== first.qi);
    ok(next && next.clip !== undefined, 'the next question plays its own clip', run.heard);
    // Determinism: the same seed and inputs → the same state, with real clips or silent ones.
    const again = playOnce(7, text, script);
    ok(again.hash === run.hash && JSON.stringify(again.heard) === JSON.stringify(run.heard), 'same seed and taps → same state and same clips heard');
    const silent = JSON.parse(text);
    const blank = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQIAAAAAAA==';
    for (const id of Object.keys(silent.assets)) if (id.startsWith('clip_')) silent.assets[id] = { sound: blank };
    const quiet = playOnce(7, JSON.stringify(silent), script);
    ok(quiet.hash === run.hash && quiet.status.score === run.status.score, 'swapping every clip for silence changes nothing in the state or score (audio is presentation only)', { a: run.status, b: quiet.status });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
