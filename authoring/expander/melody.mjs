// Melody clips: short original tunes written as notes, rendered at build time into WAV sound assets
// (authoring/SPEC.md 2.9, "clips"). Pure JS with no imports, so the app can bundle it with the expander.
//
// A clip is what Muse writes for a listen-and-answer round: a lead line, chords, an optional bass
// line and a drum pattern, in a compact text notation, plus a style that picks the instruments,
// grooves and recording colour of an era ("80s": gated snare, saw lead, big room). The renderer
// turns it into a mono 16-bit WAV at 11,025 Hz (the runtime low-passes at 6 kHz anyway).
//
// Determinism: the renderer uses only + - * / and floor/round. Sines, exponentials and noise are
// computed here (a polynomial sine, a series exp, an integer PRNG), never with Math.sin, Math.exp or
// Math.random, so the same clip gives the same bytes in Node, JavaScriptCore and every browser.
// Clips are presentation only: the engine plays them as feedback and never reads them, so they
// can't change a score or a replay.

export const CLIP_RATE = 11025;
// Over `hifi_seconds` of clips in one game, every clip is written as 8-bit to keep the game small
// (about 15 KB per second of clip instead of 30).
export const CLIP_LIMITS = { clips: 12, bars: 8, seconds: 10, total_seconds: 80, hifi_seconds: 30, bpm: [50, 200] };

const NOTE_RE = /^([A-Ga-g])(#|b)?([0-8])$/;
const DUR_RE = /^(1|2|4|8|16)(\.)?$/;

// ---------------------------------------------------------------- deterministic math

const TAU = 6.283185307179586;
const LN2 = 0.6931471805599453;

/** sin(2π·p) for any p, from a polynomial: identical in every JS engine. */
export function sin2pi(p) {
  let x = p - Math.floor(p); // 0..1
  let sign = 1;
  if (x >= 0.5) { x -= 0.5; sign = -1; } // sin(2π(x+½)) = −sin(2πx)
  if (x > 0.25) x = 0.5 - x; // symmetric about ¼
  const t = x * TAU; // 0..π/2
  const t2 = t * t;
  // Taylor to t^13: error < 1e-9 on [0, π/2]
  const s = t * (1 + t2 * (-1 / 6 + t2 * (1 / 120 + t2 * (-1 / 5040 + t2 * (1 / 362880 + t2 * (-1 / 39916800 + t2 * (1 / 6227020800)))))));
  return sign * s;
}

/** e^x from range reduction and a series: identical in every JS engine. */
export function expD(x) {
  if (x < -700) return 0;
  if (x > 700) x = 700;
  const n = Math.round(x / LN2);
  const r = x - n * LN2; // |r| ≤ ln2/2
  let term = 1, sum = 1;
  for (let i = 1; i < 18; i++) { term = (term * r) / i; sum += term; }
  let scale = 1;
  if (n > 0) for (let i = 0; i < n; i++) scale *= 2;
  else for (let i = 0; i < -n; i++) scale *= 0.5;
  return sum * scale;
}

const pow2 = (x) => expD(x * LN2);

/** A 32-bit xorshift PRNG; returns floats in −1..1. */
function noiseGen(seed) {
  let s = (seed | 0) || 0x1234567;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/** Note name ('C5', 'F#4', 'Bb3') → MIDI number, or NaN. */
export function noteMidi(n) {
  const m = NOTE_RE.exec(n);
  if (!m) return NaN;
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
}
const midiHz = (m) => 440 * pow2((m - 69) / 12);

// ---------------------------------------------------------------- styles

// Instruments a part can use. Each is synthesized below.
export const INSTRUMENTS = {
  sine: 'pure sine',
  triangle: 'soft triangle',
  square: 'hollow square lead',
  pulse: 'thin pulse lead',
  chip: '8-bit pulse (unfiltered, for chiptune)',
  saw: 'bright saw synth lead',
  supersaw: 'three detuned saws (trance and EDM)',
  brass: 'synth brass with a slow swell',
  strings: 'string pad, slow attack',
  pad: 'warm poly-synth pad',
  organ: 'combo organ with vibrato',
  piano: 'acoustic-style piano',
  epiano: 'electric piano (FM)',
  bell: 'glassy FM bell',
  pluck: 'plucked guitar or harp',
  harpsichord: 'bright plucked harpsichord',
  flute: 'breathy flute',
  bass: 'round finger bass',
  synth_bass: 'resonant analog synth bass',
  fm_bass: 'punchy FM bass',
  sub: 'deep 808 sub bass',
  chip_bass: '8-bit triangle bass',
};

const DRUM_KEYS = ['kick', 'snare', 'hat', 'open', 'clap', 'tamb', 'rim'];

// Original grooves, one bar of 16 steps ('x' hit, 'X' accent, '.' rest). Not taken from any song.
export const GROOVES = {
  none: {},
  shuffle: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', rim: '' },
  backbeat: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', tamb: '..x...x...x...x.' },
  disco: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', open: '..x...x...x...x.' },
  gated: { kick: 'x.......x.x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
  house: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '..x...x...x...x.' },
  breakbeat: { kick: 'x.....x...x.....', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx' },
  rnb: { kick: 'x......x..x.....', clap: '....x.......x...', hat: 'x.x.x.x.x.xxx.x.', rim: '...........x....' },
  trap: { kick: 'x.......x.....x.', clap: '........x.......', hat: 'x.x.x.xxx.x.x.xx' },
  chip: { kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.' },
  waltz: { kick: 'x...........', snare: '....x...x...', hat: 'x.x.x.x.x.x.' },
};

// Chord patterns ("comp"): how the chord part plays each chord.
export const COMPS = ['pad', 'stabs', 'offbeat', 'strum', 'arp', 'boogie', 'block'];
// Bass patterns when "bass" is "auto".
export const BASS_LINES = ['root', 'root8', 'octave', 'walk', 'root_fifth', 'offbeat', 'sub'];

// Era styles: original generic arrangements typical of a period, not of any one song.
export const STYLES = {
  '50s': { describe: 'Shuffle rock and roll: boogie piano, walking bass, brushed drums, mono and a little crackle.', bpm: 150, swing: 1, lead: 'piano', chord: 'piano', bass_sound: 'bass', comp: 'boogie', bass: 'walk', drums: 'shuffle', color: { lowpass: 2800, crackle: 0.6, room: 0.15 } },
  '60s': { describe: 'Beat-group pop: combo organ lead, strummed guitar, root-fifth bass, tambourine backbeat, spring reverb.', bpm: 128, swing: 0.15, lead: 'organ', chord: 'pluck', bass_sound: 'bass', comp: 'strum', bass: 'root_fifth', drums: 'backbeat', color: { lowpass: 4200, hiss: 0.25, room: 0.35 } },
  '70s': { describe: 'Disco and soul: string lead, electric piano chords, octave bass, four-on-the-floor with open hats, tape warmth.', bpm: 116, swing: 0, lead: 'strings', chord: 'epiano', bass_sound: 'bass', comp: 'offbeat', bass: 'octave', drums: 'disco', color: { lowpass: 5000, wow: 1, room: 0.25 } },
  '80s': { describe: 'Synth-pop: saw or brass synth lead, poly-synth pad, driving 8th-note synth bass, big gated snare.', bpm: 112, swing: 0, lead: 'saw', chord: 'pad', bass_sound: 'synth_bass', comp: 'pad', bass: 'root8', drums: 'gated', color: { room: 0.55 } },
  '90s': { describe: 'Dance and house: piano stabs, offbeat FM bass, four-on-the-floor kick, claps and open hats.', bpm: 126, swing: 0, lead: 'supersaw', chord: 'piano', bass_sound: 'fm_bass', comp: 'stabs', bass: 'offbeat', drums: 'house', color: { room: 0.2 } },
  '00s': { describe: 'Pop and R&B: plucky synth lead, soft pad, syncopated kick, claps and busy hats, punchy and loud.', bpm: 98, swing: 0.2, lead: 'pluck', chord: 'pad', bass_sound: 'synth_bass', comp: 'pad', bass: 'root', drums: 'rnb', color: { room: 0.15, drive: 0.3 } },
  '10s': { describe: 'EDM and trap pop: supersaw chords, bell lead, 808 sub bass, rolling hats, very loud.', bpm: 140, swing: 0, lead: 'bell', chord: 'supersaw', bass_sound: 'sub', comp: 'pad', bass: 'sub', drums: 'trap', color: { room: 0.3, drive: 0.45 } },
  chip: { describe: '8-bit game music: pulse lead, triangle bass, noise drums, no reverb.', bpm: 150, swing: 0, lead: 'chip', chord: 'chip', bass_sound: 'chip_bass', comp: 'arp', bass: 'root8', drums: 'chip', color: { crush: 1 } },
  baroque: { describe: 'Harpsichord and flute, no drums, a small hall.', bpm: 100, swing: 0, lead: 'flute', chord: 'harpsichord', bass_sound: 'harpsichord', comp: 'arp', bass: 'root', drums: 'none', color: { room: 0.3 } },
  plain: { describe: 'Just the notes: a sine lead and soft chords, no drums or colour. For ear training and pitch games.', bpm: 100, swing: 0, lead: 'sine', chord: 'triangle', bass_sound: 'triangle', comp: 'pad', bass: 'root', drums: 'none', color: {} },
};

const FIELDS = ['style', 'bpm', 'meter', 'bars', 'swing', 'lead', 'chords', 'bass', 'drums', 'lead_sound', 'chord_sound', 'bass_sound', 'comp', 'volume', 'label'];

// ---------------------------------------------------------------- parsing

/** Parses a note line ("A4/8 C5 E5/4. r/8 ..."). Returns {events: [{midi|null, at, len}], steps} or {error}. */
export function parseLine(text, maxSteps) {
  if (typeof text !== 'string') return { error: 'a string of notes like "C5/4 E5/8 G5 r/4"' };
  const toks = text.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return { error: 'at least one note' };
  if (toks.length > 128) return { error: 'at most 128 notes' };
  const events = [];
  let at = 0, len = 4;
  for (const tok of toks) {
    const [name, dur, ...rest] = tok.split('/');
    if (rest.length) return { error: `'${tok}' has two durations` };
    if (dur !== undefined) {
      const d = DUR_RE.exec(dur);
      if (!d) return { error: `'${tok}': a duration is /1 /2 /4 /8 or /16, optionally dotted like /4.` };
      const base = 16 / Number(d[1]);
      len = d[2] ? base * 1.5 : base;
      if (len !== Math.floor(len)) return { error: `'${tok}': a dotted 16th is too short; use /16 or /8` };
    }
    let midi = null;
    if (name !== 'r' && name !== 'R' && name !== '-') {
      midi = noteMidi(name);
      if (!Number.isFinite(midi)) return { error: `'${tok}' isn't a note: write a name and octave like C5, F#4 or Bb3, or r for a rest` };
      if (midi < 24 || midi > 108) return { error: `'${tok}' is out of range (C1 to C8)` };
    }
    if (at + len > maxSteps) { if (at < maxSteps) events.push({ midi, at, len: maxSteps - at }); return { events, steps: maxSteps, trimmed: true }; }
    if (midi !== null) events.push({ midi, at, len });
    at += len;
  }
  return { events, steps: at };
}

const CHORD_RE = /^([A-G])(#|b)?(maj7|m7b5|m7|m6|m|dim7|dim|aug|sus2|sus4|add9|maj|7|6|9|5)?$/;
const QUALITY = {
  '': [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 14], '5': [0, 7],
};

/** Parses chords ("Am F C G" one per bar, or "Am/2 F/2 ..."). Returns {chords: [{root, tones, at, len}]} or {error}. */
export function parseChords(text, barSteps, maxSteps) {
  if (typeof text !== 'string') return { error: 'a string of chord names like "Am F C G"' };
  const toks = text.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return { error: 'at least one chord' };
  if (toks.length > 64) return { error: 'at most 64 chords' };
  const chords = [];
  let at = 0;
  for (const tok of toks) {
    const [name, dur, ...rest] = tok.split('/');
    if (rest.length || (dur !== undefined && /^[A-G]/.test(dur))) return { error: `'${tok}': slash chords aren't supported; write the chord and a duration like Am/2` };
    let len = barSteps;
    if (dur !== undefined) {
      const d = DUR_RE.exec(dur);
      if (!d) return { error: `'${tok}': a chord duration is /1 (a bar) /2 /4 or /8, optionally dotted` };
      len = (16 / Number(d[1])) * (d[2] ? 1.5 : 1);
    }
    if (name === 'r' || name === 'N.C.' || name === 'NC') { at += len; continue; }
    const m = CHORD_RE.exec(name);
    if (!m) return { error: `'${name}' isn't a chord this renderer knows: a root (C, F#, Bb) and one of ${Object.keys(QUALITY).filter(Boolean).join(', ')}, or none for major` };
    const root = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    if (at >= maxSteps) break;
    chords.push({ root: (root + 12) % 12, tones: QUALITY[m[3] ?? ''], at, len: Math.min(len, maxSteps - at) });
    at += len;
  }
  return { chords };
}

function parseDrums(v, barSteps, maxSteps) {
  if (v === undefined) return { error: null, auto: true };
  if (v === 'none' || v === false || v === null) return { lines: {} };
  if (v === 'auto') return { auto: true };
  if (typeof v === 'string') {
    if (!GROOVES[v]) return { error: `drums '${v}' isn't a groove: one of ${Object.keys(GROOVES).join(', ')}, "auto", "none" or {kick, snare, hat, ...}` };
    return { lines: GROOVES[v] };
  }
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'drums is a groove name, "auto", "none" or {"kick": "x...x...", ...}' };
  for (const [k, s] of Object.entries(v)) {
    if (!DRUM_KEYS.includes(k)) return { error: `drums has no '${k}' (${DRUM_KEYS.join(', ')})` };
    if (typeof s !== 'string' || !/^[xX.]+$/.test(s) || s.length > maxSteps) return { error: `drums.${k} is a string of x (hit), X (accent) and . (rest), one per 16th note, at most ${maxSteps} long; it repeats to fill the clip` };
  }
  return { lines: v };
}

/**
 * Checks a clip spec. Returns {problems: [{at, message}], plan} where plan is the normalized clip
 * (only when there are no problems). `at` is a JSON-pointer suffix like "/lead".
 */
export function checkClip(spec) {
  const problems = [];
  const bad = (at, message) => problems.push({ at, message });
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { problems: [{ at: '', message: 'a clip is an object like {"style": "80s", "bpm": 112, "bars": 4, "lead": "A4/8 C5 E5 ...", "chords": "Am F C G"}' }] };
  for (const k of Object.keys(spec)) if (!FIELDS.includes(k)) bad(`/${k}`, `a clip has no '${k}' (${FIELDS.join(', ')})`);
  const styleName = spec.style ?? 'plain';
  const style = STYLES[styleName];
  if (!style) bad('/style', `no style '${styleName}': one of ${Object.keys(STYLES).join(', ')}`);
  const st = style || STYLES.plain;
  const bpm = spec.bpm ?? st.bpm;
  if (!(Number.isFinite(bpm) && bpm >= CLIP_LIMITS.bpm[0] && bpm <= CLIP_LIMITS.bpm[1])) bad('/bpm', `bpm from ${CLIP_LIMITS.bpm[0]} to ${CLIP_LIMITS.bpm[1]}`);
  const meter = spec.meter ?? 4;
  if (meter !== 3 && meter !== 4) bad('/meter', 'meter is 4 (4/4) or 3 (3/4)');
  const bars = spec.bars ?? 4;
  if (!(Number.isInteger(bars) && bars >= 1 && bars <= CLIP_LIMITS.bars)) bad('/bars', `bars from 1 to ${CLIP_LIMITS.bars}`);
  const swing = spec.swing ?? st.swing;
  if (!(Number.isFinite(swing) && swing >= 0 && swing <= 1)) bad('/swing', 'swing from 0 (straight) to 1 (full shuffle)');
  const volume = spec.volume ?? 1;
  if (!(Number.isFinite(volume) && volume > 0 && volume <= 1)) bad('/volume', 'volume above 0, up to 1');
  for (const k of ['lead_sound', 'chord_sound', 'bass_sound']) if (spec[k] !== undefined && !INSTRUMENTS[spec[k]]) bad(`/${k}`, `no instrument '${spec[k]}': one of ${Object.keys(INSTRUMENTS).join(', ')}`);
  if (spec.comp !== undefined && !COMPS.includes(spec.comp)) bad('/comp', `comp is one of ${COMPS.join(', ')}`);
  if (spec.label !== undefined && typeof spec.label !== 'string') bad('/label', 'label is a note for reviewers (a string)');
  if (problems.length) return { problems };

  const barSteps = meter * 4;
  const steps = bars * barSteps;
  const stepSec = 15 / bpm;
  const seconds = steps * stepSec;
  if (seconds > CLIP_LIMITS.seconds + 1e-9) bad('/bars', `this clip lasts ${seconds.toFixed(1)} s; keep it under ${CLIP_LIMITS.seconds} s (fewer bars or a faster bpm)`);

  let lead = { events: [] }, trimmed = false;
  if (spec.lead !== undefined) {
    lead = parseLine(spec.lead, steps);
    if (lead.error) bad('/lead', `lead: ${lead.error}`);
    trimmed = !!lead.trimmed;
  }
  let chords = { chords: [] };
  if (spec.chords !== undefined) {
    chords = parseChords(spec.chords, barSteps, steps);
    if (chords.error) bad('/chords', chords.error);
  }
  let bass = null;
  const bassSpec = spec.bass ?? 'auto';
  if (typeof bassSpec === 'string' && (bassSpec === 'auto' || BASS_LINES.includes(bassSpec))) bass = { pattern: bassSpec === 'auto' ? st.bass : bassSpec };
  else if (bassSpec === 'none' || bassSpec === false) bass = null;
  else {
    const b = parseLine(bassSpec, steps);
    if (b.error) bad('/bass', `bass is "auto", "none", a pattern (${BASS_LINES.join(', ')}) or notes: ${b.error}`);
    else bass = { events: b.events };
  }
  const drums = parseDrums(spec.drums, barSteps, steps);
  if (drums.error) bad('/drums', drums.error);
  if (spec.lead === undefined && spec.chords === undefined) bad('', 'a clip needs a lead line, chords, or both');
  if (problems.length) return { problems };

  return {
    problems,
    trimmed,
    plan: {
      style: styleName, st, bpm, meter, bars, barSteps, steps, stepSec, swing, volume,
      lead: lead.events, chords: chords.chords, bass,
      drums: drums.auto ? GROOVES[st.drums] : drums.lines,
      leadSound: spec.lead_sound ?? st.lead, chordSound: spec.chord_sound ?? st.chord, bassSound: spec.bass_sound ?? st.bass_sound,
      comp: spec.comp ?? st.comp,
      seed: hashString(JSON.stringify(spec)),
    },
  };
}

// ---------------------------------------------------------------- instruments

const R = CLIP_RATE;

// PolyBLEP correction for band-limited saw and square.
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

function oscSample(kind, phase, dt) {
  const p = phase - Math.floor(phase);
  switch (kind) {
    case 'sine': return sin2pi(p);
    case 'triangle': return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 'saw': return 2 * p - 1 - blep(p, dt);
    case 'square': {
      let v = p < 0.5 ? 1 : -1;
      v += blep(p, dt);
      const q = p + 0.5 - Math.floor(p + 0.5);
      v -= blep(q, dt);
      return v * 0.8;
    }
    case 'pulse': {
      let v = p < 0.25 ? 1 : -1;
      v += blep(p, dt);
      const q = p + 0.75 - Math.floor(p + 0.75);
      v -= blep(q, dt);
      return v * 0.7;
    }
    case 'chip': return (p < 0.25 ? 1 : -1) * 0.6; // naive on purpose: the aliasing is the 8-bit sound
    case 'chip_tri': { const s = Math.floor(p * 16); const v = s < 8 ? s : 15 - s; return (v / 3.5 - 1); }
    default: return sin2pi(p);
  }
}

/**
 * Renders one note into `buf` from sample `start` for `len` samples (plus the instrument's release).
 * `vel` 0..1. `rnd` is the clip's noise source.
 */
function playNote(buf, inst, hz, start, len, vel, rnd) {
  const n = buf.length;
  const rel = { pad: 0.35, strings: 0.3, organ: 0.04, brass: 0.12, flute: 0.08, sub: 0.15 }[inst] ?? 0.06;
  const total = len + Math.floor(rel * R);
  const dt = hz / R;
  const g = vel;
  const decayMul = (perSec) => expD(-perSec / R);
  let env = 0;
  let phase = 0, phase2 = 0, phase3 = 0, phaseM = 0;
  let lp = 0, bp = 0; // filter state
  let releaseEnv = 1;
  const relMul = decayMul(1 / Math.max(0.01, rel) * 4);
  // per-instrument settings
  const attackS = { strings: 0.12, pad: 0.08, brass: 0.06, flute: 0.04, organ: 0.006 }[inst] ?? 0.004;
  const attackStep = 1 / Math.max(1, attackS * R);
  const decay = {
    piano: 2.2, epiano: 2.4, bell: 1.6, pluck: 4.5, harpsichord: 3.2, bass: 2.5, synth_bass: 3, fm_bass: 4,
    sub: 0.9, chip_bass: 0, chip: 0, saw: 0.6, square: 0.5, pulse: 0.5, supersaw: 0.4, sine: 0.6, triangle: 0.8,
  }[inst] ?? 0;
  const dMul = decayMul(decay);
  let dEnv = 1;
  const vibRate = inst === 'organ' ? 6.2 / R : inst === 'flute' || inst === 'strings' ? 5 / R : 0;
  const vibDepth = inst === 'organ' ? 0.004 : inst === 'flute' ? 0.003 : inst === 'strings' ? 0.002 : 0;
  let vib = 0;
  // filter coefficient for the subtractive voices
  const cutoffs = { synth_bass: [1800, 260], saw: [3600, 1600], brass: [900, 2600], pad: [1600, 1600], supersaw: [3800, 3000], strings: [2600, 2600] };
  const cut = cutoffs[inst];
  let cutEnv = 1;
  const cutMul = decayMul(inst === 'synth_bass' ? 9 : inst === 'brass' ? -0 : 2);
  for (let k = 0; k < total; k++) {
    const i = start + k;
    if (i >= n) break;
    if (env < 1) env = Math.min(1, env + attackStep);
    if (k >= len) releaseEnv *= relMul;
    dEnv *= dMul;
    const amp = env * releaseEnv * (decay ? dEnv : 1);
    if (amp < 1e-5 && k > len) break;
    let f = 1;
    if (vibRate) { vib += vibRate; f = 1 + vibDepth * sin2pi(vib); }
    const d = dt * f;
    let v;
    switch (inst) {
      case 'sine': case 'triangle': case 'square': case 'pulse': case 'chip':
        v = oscSample(inst, phase, d); phase += d; break;
      case 'chip_bass': v = oscSample('chip_tri', phase, d); phase += d; break;
      case 'saw': case 'synth_bass': case 'brass': case 'pad': case 'strings': case 'supersaw': {
        if (inst === 'synth_bass') v = oscSample('saw', phase, d) * 0.7 + oscSample('square', phase * 0.5 + 0.25, d * 0.5) * 0.3;
        else if (inst === 'supersaw' || inst === 'strings' || inst === 'pad') {
          const det = inst === 'supersaw' ? 0.011 : inst === 'strings' ? 0.006 : 0.004;
          v = (oscSample('saw', phase, d) + oscSample('saw', phase2, d * (1 + det)) + oscSample('saw', phase3, d * (1 - det))) / 2.2;
          phase2 += d * (1 + det); phase3 += d * (1 - det);
        } else v = oscSample('saw', phase, d);
        phase += d;
        // two-pole state-variable lowpass with an envelope on the cutoff
        if (inst === 'brass') cutEnv = Math.min(1, k / (0.08 * R));
        else cutEnv *= cutMul;
        let fc = cut[1] + cut[0] * cutEnv;
        if (fc > R / 5) fc = R / 5;
        const fq = 2 * sin2pi(fc / R / 2);
        const q = inst === 'synth_bass' ? 0.35 : 0.9;
        lp += fq * bp; const hp = v - lp - q * bp; bp += fq * hp;
        v = lp;
        break;
      }
      case 'organ': {
        // drawbars 16' 8' 4' 2 2/3' 2'
        v = (sin2pi(phase * 0.5) * 0.5 + sin2pi(phase) + sin2pi(phase * 2) * 0.6 + sin2pi(phase * 3) * 0.35 + sin2pi(phase * 4) * 0.25) / 2.2;
        v += (k < 0.006 * R ? rnd() * 0.25 : 0); // key click
        phase += d; break;
      }
      case 'piano': case 'harpsichord': case 'pluck': {
        const parts = inst === 'harpsichord' ? 10 : inst === 'pluck' ? 7 : 8;
        let s = 0;
        const tt = k / R;
        for (let h = 1; h <= parts; h++) {
          if (hz * h > R / 2.2) break;
          const a = inst === 'harpsichord' ? 1 / (1 + 0.3 * h) : inst === 'pluck' ? 1 / (h * h * 0.6 + 0.4) : 1 / (h * 0.9 + 0.1 * h * h);
          const hd = expD(-tt * (h * (inst === 'piano' ? 0.9 : 1.6)));
          s += sin2pi(phase * h * (1 + 0.0004 * h * h)) * a * hd;
        }
        v = s * 0.8;
        if (k < 0.01 * R) v += rnd() * (inst === 'piano' ? 0.08 : 0.2) * (1 - k / (0.01 * R));
        phase += d; break;
      }
      case 'epiano': case 'bell': case 'fm_bass': {
        const ratio = inst === 'bell' ? 3.5 : inst === 'fm_bass' ? 1 : 1;
        const idx0 = inst === 'bell' ? 3 : inst === 'fm_bass' ? 4 : 1.8;
        const idx = idx0 * (inst === 'fm_bass' ? expD(-k / R * 12) + 0.15 : expD(-k / R * 4) + 0.1);
        const mod = sin2pi(phaseM) * idx;
        v = sin2pi(phase + mod / TAU);
        phase += d; phaseM += d * ratio; break;
      }
      case 'flute': {
        v = sin2pi(phase) * 0.9 + sin2pi(phase * 2) * 0.12 + sin2pi(phase * 3) * 0.05;
        const breath = rnd() * 0.06;
        lp += 0.2 * (breath - lp);
        v += lp;
        phase += d; break;
      }
      case 'bass': {
        v = sin2pi(phase) + sin2pi(phase * 2) * 0.35 * expD(-k / R * 6) + sin2pi(phase * 3) * 0.12 * expD(-k / R * 10);
        v *= 0.8;
        phase += d; break;
      }
      case 'sub': {
        v = sin2pi(phase);
        v = v * 1.4; v = v / (1 + (v < 0 ? -v : v) * 0.4); // a little warmth
        phase += d; break;
      }
      default: v = sin2pi(phase); phase += d;
    }
    buf[i] += v * amp * g;
  }
}

function playDrum(buf, kind, start, vel, rnd, style) {
  const n = buf.length;
  const crushNoise = style === 'chip';
  const add = (k, v) => { const i = start + k; if (i < n) buf[i] += v * vel; };
  switch (kind) {
    case 'kick': {
      const big = style === '10s' || style === '00s';
      const len = Math.floor((big ? 0.45 : 0.25) * R);
      let ph = 0;
      for (let k = 0; k < len; k++) {
        const t = k / R;
        const f = (big ? 42 : 48) + (big ? 110 : 120) * expD(-t * 30);
        ph += f / R;
        const v = (crushNoise ? (sin2pi(ph) > 0 ? 0.8 : -0.8) : sin2pi(ph)) * expD(-t * (big ? 6 : 14));
        add(k, v * 0.95 + (k < 30 ? rnd() * 0.15 : 0));
      }
      break;
    }
    case 'snare': {
      const gated = style === '80s';
      const len = Math.floor((gated ? 0.26 : 0.18) * R);
      let ph = 0, lp = 0;
      for (let k = 0; k < len; k++) {
        const t = k / R;
        ph += 190 / R;
        let noise = rnd();
        if (crushNoise) noise = noise > 0 ? 0.6 : -0.6;
        lp += 0.5 * (noise - lp);
        const nEnv = gated ? (t < 0.24 ? 0.75 * expD(-t * 2.5) : 0) : expD(-t * 18);
        const v = sin2pi(ph) * expD(-t * 30) * 0.5 + (noise - lp * 0.6) * nEnv * 0.6;
        add(k, v);
      }
      break;
    }
    case 'hat': case 'open': {
      const len = Math.floor((kind === 'open' ? 0.22 : 0.05) * R);
      let prev = 0;
      for (let k = 0; k < len; k++) {
        const t = k / R;
        let noise = rnd();
        if (crushNoise) noise = noise > 0 ? 0.5 : -0.5;
        const hp = noise - prev; prev = noise; // brighten
        add(k, hp * 0.22 * expD(-t * (kind === 'open' ? 12 : 70)));
      }
      break;
    }
    case 'clap': {
      const len = Math.floor(0.2 * R);
      let lp = 0;
      for (let k = 0; k < len; k++) {
        const t = k / R;
        const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.3) : expD(-(t - 0.03) * 20);
        const noise = rnd();
        lp += 0.6 * (noise - lp);
        add(k, (noise - lp) * burst * 0.55);
      }
      break;
    }
    case 'tamb': {
      const len = Math.floor(0.09 * R);
      let prev = 0;
      for (let k = 0; k < len; k++) {
        const noise = rnd(); const hp = noise - prev; prev = noise;
        add(k, hp * 0.16 * expD(-(k / R) * 35) * (1 + 0.5 * sin2pi(k * 0.27)));
      }
      break;
    }
    case 'rim': {
      const len = Math.floor(0.04 * R);
      let ph = 0;
      for (let k = 0; k < len; k++) { ph += 1650 / R; add(k, sin2pi(ph) * 0.35 * expD(-(k / R) * 90) + (k < 20 ? rnd() * 0.2 : 0)); }
      break;
    }
  }
}

// ---------------------------------------------------------------- arrangement

// Folds a chord into a voicing around `center` (MIDI), lowest note first.
function voice(root, tones, center) {
  const notes = tones.map((t) => {
    let m = 60 + ((root + t) % 12);
    while (m < center - 6) m += 12;
    while (m > center + 6) m -= 12;
    return m;
  });
  return [...new Set(notes)].sort((a, b) => a - b);
}

function chordEvents(plan) {
  const out = []; // {midi, at, len, vel, offset?}
  const { comp } = plan;
  for (const c of plan.chords) {
    const notes = voice(c.root, c.tones.filter((t) => t < 12), comp === 'boogie' ? 57 : 62);
    const end = c.at + c.len;
    const hit = (at, len, vel, spread = 0) => {
      if (at >= end) return;
      notes.forEach((m, j) => out.push({ midi: m, at, len: Math.min(len, end - at), vel, offset: spread * j }));
    };
    switch (comp) {
      case 'pad': hit(c.at, c.len, 0.32); break;
      case 'block': for (let s = c.at; s < end; s += 4) hit(s, 3, 0.3); break;
      case 'stabs': for (let s = c.at; s < end; s += 4) hit(s + 2, 1, 0.38); break;
      case 'offbeat': for (let s = c.at; s < end; s += 4) hit(s + 2, 2, 0.3); break;
      case 'strum': for (let s = c.at; s < end; s += 4) hit(s, 4, ((s - c.at) / 4) % 2 ? 0.22 : 0.3, 0.012); break;
      case 'arp': {
        const seq = [...notes, notes[0] + 12];
        let j = 0;
        for (let s = c.at; s < end; s += 2) { out.push({ midi: seq[j % seq.length], at: s, len: 2, vel: 0.3 }); j++; }
        break;
      }
      case 'boogie': {
        // root-fifth-sixth shuffle figure in the left hand
        const r = 48 + c.root;
        const fig = [0, 7, 0, 9, 0, 10, 0, 9];
        for (let s = c.at, j = 0; s < end; s += 2, j++) out.push({ midi: r + fig[j % 8], at: s, len: 2, vel: j % 2 ? 0.22 : 0.3 });
        break;
      }
    }
  }
  return out;
}

function bassEvents(plan) {
  if (!plan.bass) return [];
  if (plan.bass.events) return plan.bass.events.map((e) => ({ ...e, vel: 0.6 }));
  const out = [];
  const pat = plan.bass.pattern;
  for (const c of plan.chords) {
    let r = 36 + c.root; // C2..B2
    if (r > 43) r -= 12;
    const third = c.tones[1] ?? 7, fifth = c.tones.includes(7) ? 7 : c.tones[c.tones.length - 1] % 12;
    const end = c.at + c.len;
    const put = (at, midi, len, vel = 0.6) => { if (at < end) out.push({ midi, at, len: Math.min(len, end - at), vel }); };
    switch (pat) {
      case 'root': for (let s = c.at; s < end; s += 4) put(s, r, 4); break;
      case 'root8': for (let s = c.at; s < end; s += 2) put(s, r, 2, (s - c.at) % 4 ? 0.5 : 0.6); break;
      case 'octave': for (let s = c.at, j = 0; s < end; s += 2, j++) put(s, j % 2 ? r + 12 : r, 2); break;
      case 'walk': { const w = [0, third, fifth, 9]; for (let s = c.at, j = 0; s < end; s += 4, j++) put(s, r + w[j % 4], 4); break; }
      case 'root_fifth': for (let s = c.at, j = 0; s < end; s += 4, j++) put(s, j % 2 ? r + fifth - 12 + (r + fifth - 12 < 33 ? 12 : 0) : r, 3); break;
      case 'offbeat': for (let s = c.at; s < end; s += 4) put(s + 2, r + 12, 2); break;
      case 'sub': { put(c.at, r, Math.min(c.len, 6), 0.75); if (c.len > 8) put(c.at + 10, r, Math.min(6, c.len - 10), 0.7); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- effects

function lowpass(buf, fc) {
  const a = 1 - expD(-TAU * fc / R);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
}

function reverb(buf, mix) {
  if (!(mix > 0)) return;
  const combs = [279, 297, 319, 339].map((d) => ({ d, b: new Float64Array(d), i: 0, lp: 0 }));
  const aps = [139, 110].map((d) => ({ d, b: new Float64Array(d), i: 0 }));
  const fb = 0.72 + mix * 0.18;
  for (let n = 0; n < buf.length; n++) {
    const x = buf[n];
    let s = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.lp += 0.45 * (y - c.lp);
      c.b[c.i] = x + c.lp * fb;
      c.i = c.i + 1 === c.d ? 0 : c.i + 1;
      s += y;
    }
    s *= 0.25;
    for (const a of aps) {
      // Schroeder allpass: y = −g·x + d, and the line takes x + g·y
      const d = a.b[a.i];
      const y = -0.5 * s + d;
      a.b[a.i] = s + 0.5 * y;
      a.i = a.i + 1 === a.d ? 0 : a.i + 1;
      s = y;
    }
    buf[n] = x + s * mix;
  }
}

function tapeWow(buf) {
  const src = Float64Array.from(buf);
  const depth = 0.0025 * R; // samples
  for (let n = 0; n < buf.length; n++) {
    const pos = n - depth * (1 + sin2pi((n / R) * 0.55)) * 0.5;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = i >= 0 && i < src.length ? src[i] : 0;
    const b = i + 1 >= 0 && i + 1 < src.length ? src[i + 1] : 0;
    buf[n] = a + (b - a) * f;
  }
}

function addSurface(buf, rnd, hiss, crackle) {
  let lp = 0;
  for (let n = 0; n < buf.length; n++) {
    const x = rnd();
    lp += 0.3 * (x - lp);
    let v = lp * 0.012 * hiss;
    if (crackle && rnd() > 1 - 0.0009 * crackle) v += rnd() * 0.12;
    buf[n] += v;
  }
}

function crush(buf) {
  for (let n = 0; n < buf.length; n++) buf[n] = Math.round(buf[n] * 24) / 24;
}

// ---------------------------------------------------------------- render

/** Renders a checked plan to float samples. */
function renderPlan(plan) {
  const { stepSec, steps, swing } = plan;
  const tail = 0.5;
  const n = Math.round((steps * stepSec + tail) * R);
  const out = new Float64Array(n);
  const rnd = noiseGen(plan.seed);
  // Swing delays every off-beat 8th (the 3rd 16th of each beat).
  const startOf = (at) => {
    let t = at * stepSec;
    if (swing > 0 && at % 4 === 2) t += swing * (2 / 3) * stepSec;
    return Math.round(t * R);
  };
  const lenOf = (at, len) => Math.max(1, Math.round(len * stepSec * R * 0.94));

  const leadBuf = new Float64Array(n), chordBuf = new Float64Array(n), bassBuf = new Float64Array(n), drumBuf = new Float64Array(n);
  for (const e of plan.lead) playNote(leadBuf, plan.leadSound, midiHz(e.midi), startOf(e.at), lenOf(e.at, e.len), 0.55, rnd);
  for (const e of chordEvents(plan)) playNote(chordBuf, plan.chordSound, midiHz(e.midi), startOf(e.at) + Math.round((e.offset ?? 0) * R), lenOf(e.at, e.len), e.vel * 0.7, rnd);
  for (const e of bassEvents(plan)) playNote(bassBuf, plan.bassSound, midiHz(e.midi), startOf(e.at), lenOf(e.at, e.len), e.vel * 0.75, rnd);
  for (const [kind, line] of Object.entries(plan.drums || {})) {
    if (!line) continue;
    for (let s = 0; s < steps; s++) {
      const ch = line[s % line.length];
      if (ch === 'x' || ch === 'X') playDrum(drumBuf, kind, startOf(s), ch === 'X' ? 0.95 : 0.7, rnd, plan.style);
    }
  }
  const c = plan.st.color || {};
  // The lead sits on top; the room is applied to everything but the kick-heavy low end stays dry-ish.
  for (let i = 0; i < n; i++) out[i] = leadBuf[i] * 1.0 + chordBuf[i] * 0.8 + bassBuf[i] * 0.9 + drumBuf[i] * 0.85;
  if (c.room) reverb(out, c.room);
  if (c.wow) tapeWow(out);
  if (c.lowpass) lowpass(out, c.lowpass);
  if (c.hiss || c.crackle) addSurface(out, rnd, c.hiss ?? 0.4, c.crackle ?? 0);
  if (c.crush) crush(out);
  // Normalize, then soft-clip (louder eras drive harder).
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = out[i] < 0 ? -out[i] : out[i]; if (a > peak) peak = a; }
  const drive = 1 + (c.drive ?? 0) * 1.5;
  const k = peak > 0 ? (0.9 / peak) * drive * plan.volume : 0;
  for (let i = 0; i < n; i++) {
    let v = out[i] * k;
    if (drive > 1) v = v / (1 + (v < 0 ? -v : v) * (drive - 1) * 0.5) * (1 + (drive - 1) * 0.5) * 0.95;
    out[i] = v > 0.98 ? 0.98 : v < -0.98 ? -0.98 : v;
  }
  // 15 ms fade in and out so a clip never clicks.
  const fade = Math.round(0.015 * R);
  for (let i = 0; i < fade && i < n; i++) { out[i] *= i / fade; out[n - 1 - i] *= i / fade; }
  return out;
}

/**
 * Float samples → a mono PCM WAV as bytes: 16-bit, or 8-bit (half the size, with a fixed dither) when
 * a game has many seconds of clips.
 */
export function wavBytes(samples, rate = R, bits = 16) {
  const n = samples.length;
  const bps = bits === 8 ? 1 : 2;
  const bytes = new Uint8Array(44 + n * bps);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * bps, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * bps, true); dv.setUint16(32, bps, true); dv.setUint16(34, bits === 8 ? 8 : 16, true);
  str(36, 'data'); dv.setUint32(40, n * bps, true);
  if (bps === 2) for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
  else {
    const rnd = noiseGen(0x5eed);
    for (let i = 0; i < n; i++) {
      const v = Math.round(samples[i] * 127 + (rnd() + rnd()) * 0.5) + 128;
      bytes[44 + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return bytes;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    s += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    s += c === undefined ? '=' : B64[c & 63];
  }
  return s;
}

/**
 * Renders one clip. Returns {ok: true, bytes (WAV), uri (data:audio/wav;base64,…), ms, trimmed}
 * or {ok: false, problems}. Same spec → same bytes, everywhere.
 */
export function renderClip(spec, { bits = 16 } = {}) {
  const { problems, plan, trimmed } = checkClip(spec);
  if (problems.length) return { ok: false, problems };
  const samples = renderPlan(plan);
  const bytes = wavBytes(samples, R, bits);
  return { ok: true, bytes, uri: 'data:audio/wav;base64,' + base64(bytes), ms: Math.round((plan.steps * plan.stepSec) * 1000), trimmed };
}

/**
 * The manifest's `sound.clips` (a list): checks and renders each clip to an asset `clip_<i>`.
 * err(code, at, message, extra) / warn(...) report diagnostics at `/sound/clips/<i>…`.
 * Returns {assets: {clip_0: {sound: uri}, …}, ms: [length of each clip in ms], longest_ms}.
 */
export function compileClips(list, err, warn = () => {}) {
  const at = '/sound/clips';
  const assets = {};
  const ms = [];
  if (list === undefined) return { assets, ms, longest_ms: 0 };
  if (!Array.isArray(list)) { err('A_SOUND_FIELD', at, 'clips is a list of clips; clip i becomes the sound asset clip_<i>'); return { assets, ms, longest_ms: 0 }; }
  if (list.length > CLIP_LIMITS.clips) err('A_SOUND_FIELD', at, `at most ${CLIP_LIMITS.clips} clips`);
  // First pass: check every clip and add up the seconds, which decides 16-bit or 8-bit for all.
  const checked = list.slice(0, CLIP_LIMITS.clips).map((spec) => checkClip(spec));
  let total = 0;
  for (const c of checked) if (c.plan) total += c.plan.steps * c.plan.stepSec;
  const bits = total > CLIP_LIMITS.hifi_seconds ? 8 : 16;
  checked.forEach((c, i) => {
    const spec = list[i];
    if (c.problems.length) {
      for (const p of c.problems) err('A_SOUND_CLIP', `${at}/${i}${p.at}`, p.message, { hint: 'clip notation: authoring/SPEC.md 2.9 "clips"' });
      ms.push(0);
      return;
    }
    const r = renderClip(spec, { bits });
    if (r.trimmed) warn('W_CLIP_TRIMMED', `${at}/${i}/lead`, `the lead is longer than ${spec.bars ?? 4} bars, so its end was cut`);
    assets[`clip_${i}`] = { sound: r.uri };
    ms.push(r.ms);
  });
  if (total > CLIP_LIMITS.total_seconds) err('A_SOUND_FIELD', at, `the clips last ${total.toFixed(0)} s together; keep them under ${CLIP_LIMITS.total_seconds} s`);
  return { assets, ms, longest_ms: ms.reduce((a, b) => (b > a ? b : a), 0) };
}

/** A one-line summary of the notation, for prompts and catalog `api` text. */
export const CLIP_NOTATION = 'clip = {style: ' + Object.keys(STYLES).join('|') + ', bpm, bars (1-8, under 10 s), lead: "A4/8 C5 E5 r/4 ..." (note+octave, /1 /2 /4 /8 /16, dotted /4., r = rest; a duration carries to the next notes), chords: "Am F C G" (one per bar, or Am/2), bass: auto|notes, drums: auto|none|groove|{kick: "x...x...", snare, hat, open, clap, tamb, rim}, lead_sound, chord_sound, bass_sound, comp, swing}';
