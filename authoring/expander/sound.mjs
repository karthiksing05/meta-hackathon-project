// The sound library and the manifest's `sound` section (authoring/SPEC.md 2.9). Pure JS that imports
// only melody.mjs, so the app can bundle it with the expander.
//
// Fragments and games never write synth notes for the common moments. They write
// `{ "moment": "pickup" }` in a feedback `do` list, and the expander swaps in the game's sound for
// that moment: from the chosen sound set, the game's overrides and its volume. Everything is
// synthesized: engine synth notes, slides and jingles, music rendered here into a short WAV loop, and
// melody clips (`clips`, melody.mjs) rendered into WAV sound assets clip_0, clip_1, ….

import { compileClips } from './melody.mjs';

export const MOMENTS = ['tap', 'pickup', 'hit', 'combo', 'level', 'countdown', 'win', 'lose'];
export const MOMENT_DOCS = {
  tap: 'a small player action: a tap on a cell, a lane change, a hop, a choice',
  pickup: 'something good: a point, a pickup, a right answer, a pair',
  hit: 'something bad: a hit, a miss, a wrong answer',
  combo: 'a streak grows, tiles merge, a pattern is repeated',
  level: 'a step up: a new wave or level, a checkpoint, passing a friend',
  countdown: 'each of the last seconds on the clock',
  win: 'the win sting',
  lose: 'the lose sting',
};

// Named synth sounds. Each is an engine sound action body: a note (optionally sliding to another)
// or a jingle of notes.
export const PRESETS = {
  // taps
  blip: { wave: 'sine', note: 'E5', ms: 50, volume: 0.45 },
  tick: { wave: 'triangle', note: 'A5', ms: 30, volume: 0.4 },
  click: { wave: 'square', note: 'C6', ms: 25, volume: 0.25 },
  pluck: { wave: 'triangle', note: 'G4', ms: 70, volume: 0.5 },
  bubble: { wave: 'sine', note: 'C5', slide: 'G5', ms: 70, volume: 0.45 },
  pip: { wave: 'square', note: 'E5', ms: 35, volume: 0.25 },
  // good things
  ding: { wave: 'sine', note: 'A5', ms: 90, volume: 0.5 },
  coin: { wave: 'square', notes: ['B5', 'E6'], step_ms: 55, volume: 0.3 },
  sparkle: { wave: 'triangle', notes: ['E6', 'B6'], step_ms: 45, volume: 0.4 },
  chirp: { wave: 'sine', note: 'C6', slide: 'G6', ms: 80, volume: 0.4 },
  bell: { wave: 'sine', notes: ['G5', 'D6'], step_ms: 70, volume: 0.45 },
  woodblock: { wave: 'triangle', note: 'D5', ms: 45, volume: 0.55 },
  // bad things
  thud: { wave: 'triangle', note: 'C3', slide: 'G2', ms: 140, volume: 0.6 },
  buzz: { wave: 'square', note: 'C3', ms: 120, volume: 0.35 },
  zap: { wave: 'sawtooth', note: 'A3', slide: 'A2', ms: 160, volume: 0.3 },
  bonk: { wave: 'sine', note: 'F3', slide: 'C3', ms: 110, volume: 0.6 },
  crunch: { wave: 'square', note: 'D3', slide: 'A2', ms: 90, volume: 0.3 },
  // streaks and steps
  rise: { wave: 'triangle', note: 'C5', slide: 'C6', ms: 120, volume: 0.45 },
  arpeggio: { wave: 'square', notes: ['C5', 'E5', 'G5'], step_ms: 50, volume: 0.25 },
  shimmer: { wave: 'sine', notes: ['E5', 'G5', 'B5'], step_ms: 60, volume: 0.4 },
  levelup: { wave: 'square', notes: ['G4', 'C5', 'E5', 'G5'], step_ms: 70, volume: 0.25 },
  chime: { wave: 'sine', notes: ['C6', 'G6'], step_ms: 90, volume: 0.4 },
  // stings
  fanfare: { wave: 'square', notes: ['C5', 'E5', 'G5', 'C6'], step_ms: 90, volume: 0.3 },
  tada: { wave: 'triangle', notes: ['G4', 'C5', 'E5', 'G5', 'C6'], step_ms: 80, volume: 0.5 },
  glow: { wave: 'sine', notes: ['C5', 'G5', 'E6'], step_ms: 120, volume: 0.45 },
  hooray: { wave: 'square', notes: ['E5', 'G5', 'E6', 'C6', 'G6'], step_ms: 75, volume: 0.25 },
  sigh: { wave: 'sine', notes: ['E5', 'C5', 'A4'], step_ms: 140, volume: 0.45 },
  fall: { wave: 'triangle', notes: ['G4', 'E4', 'C4'], step_ms: 120, slide: 'G3', volume: 0.5 },
  wah: { wave: 'sawtooth', notes: ['E4', 'D#4', 'D4'], step_ms: 160, slide: 'C#4', volume: 0.25 },
  powerdown: { wave: 'square', note: 'C5', slide: 'C3', ms: 420, volume: 0.25 },
};

// Original music loops, rendered to a WAV by renderMusic. Notes are eighth notes; null is a rest.
export const MUSIC = {
  lullaby: {
    bpm: 84, wave: 'sine', volume: 0.32,
    melody: ['E5', null, 'G5', 'A5', 'G5', null, 'E5', null, 'D5', null, 'E5', 'G5', 'E5', null, null, null],
    bass: ['C3', 'C3', 'A2', 'A2', 'F2', 'F2', 'G2', 'G2'],
  },
  bounce: {
    bpm: 132, wave: 'square', volume: 0.22,
    melody: ['C5', 'E5', 'G5', 'E5', 'A5', 'G5', 'E5', 'D5', 'C5', 'E5', 'G5', 'C6', 'B5', 'G5', 'A5', 'G5'],
    bass: ['C3', 'G2', 'A2', 'E2', 'F2', 'C3', 'G2', 'G2'],
  },
  drift: {
    bpm: 72, wave: 'triangle', volume: 0.3,
    melody: ['A4', null, 'C5', null, 'E5', null, 'D5', 'C5', 'B4', null, 'G4', null, 'A4', null, null, null],
    bass: ['A2', 'A2', 'F2', 'F2', 'G2', 'G2', 'E2', 'E2'],
  },
  chip: {
    bpm: 144, wave: 'square', volume: 0.2,
    melody: ['E5', 'E5', null, 'C5', 'D5', null, 'G4', null, 'A4', 'C5', 'E5', null, 'D5', 'C5', 'B4', null],
    bass: ['A2', 'A2', 'F2', 'F2', 'C3', 'C3', 'G2', 'E2'],
  },
};

// Sound sets: one sound per moment, plus optional music. `classic` is what a game gets when it has
// no sound section; it is close to what the fragments played before moments existed.
export const SETS = {
  classic: { describe: 'Plain, clear synth beeps.', tap: 'blip', pickup: 'ding', hit: 'buzz', combo: 'rise', level: 'shimmer', countdown: 'tick', win: 'tada', lose: 'fall', music: null },
  soft: { describe: 'Quiet, rounded sine tones for calm games.', tap: 'bubble', pickup: 'chirp', hit: 'bonk', combo: 'shimmer', level: 'chime', countdown: 'tick', win: 'glow', lose: 'sigh', music: 'drift', volume: 0.8 },
  arcade: { describe: 'Bright square-wave bleeps for fast games.', tap: 'pip', pickup: 'coin', hit: 'zap', combo: 'arpeggio', level: 'levelup', countdown: 'click', win: 'fanfare', lose: 'powerdown', music: 'bounce' },
  chime: { describe: 'Bells and sparkles for puzzles and pairs.', tap: 'tick', pickup: 'bell', hit: 'bonk', combo: 'sparkle', level: 'chime', countdown: 'tick', win: 'glow', lose: 'sigh', music: null },
  retro: { describe: 'Chiptune blips and a looping 8-bit tune.', tap: 'click', pickup: 'coin', hit: 'crunch', combo: 'arpeggio', level: 'levelup', countdown: 'pip', win: 'hooray', lose: 'wah', music: 'chip' },
  cozy: { describe: 'Wooden plucks and a soft lullaby for stories and slow play.', tap: 'woodblock', pickup: 'pluck', hit: 'thud', combo: 'shimmer', level: 'bell', countdown: 'tick', win: 'tada', lose: 'sigh', music: 'lullaby', volume: 0.9 },
};

const WAVES = ['sine', 'square', 'triangle', 'sawtooth'];
const NOTE = /^([A-G])(#|b)?([0-8])$/;
const SOUND_KEYS = ['wave', 'note', 'notes', 'ms', 'step_ms', 'slide', 'volume'];

export function noteHz(n) {
  if (typeof n === 'number') return n;
  const m = NOTE.exec(n);
  if (!m) return NaN;
  const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((Number(m[3]) - 4) + semis / 12);
}
const goodNote = (n) => (typeof n === 'number' ? n >= 20 && n <= 8000 : NOTE.test(n));

// Checks one sound body (a preset expanded or the model's own). Returns a problem string or null.
function checkSoundBody(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'a preset name, a sound object or false';
  for (const k of Object.keys(s)) if (!SOUND_KEYS.includes(k)) return `a sound with only ${SOUND_KEYS.join(', ')} (not '${k}')`;
  if (s.wave !== undefined && !WAVES.includes(s.wave)) return `wave one of ${WAVES.join(', ')}`;
  if (s.notes !== undefined) {
    if (!Array.isArray(s.notes) || !s.notes.length || s.notes.length > 8 || !s.notes.every(goodNote)) return "notes: a list of 1 to 8 notes like 'C5', 'F#4' or Hz";
    if (s.note !== undefined) return 'either note or notes, not both';
  } else if (s.note !== undefined && !goodNote(s.note)) return "note like 'C5', 'F#4', 'Bb3' or a number of Hz";
  if (s.slide !== undefined && !goodNote(s.slide)) return "slide: a note like 'C6'";
  if (s.ms !== undefined && !(Number.isFinite(s.ms) && s.ms >= 10 && s.ms <= 1500)) return 'ms between 10 and 1500';
  if (s.step_ms !== undefined && !(Number.isFinite(s.step_ms) && s.step_ms >= 20 && s.step_ms <= 600)) return 'step_ms between 20 and 600';
  if (s.volume !== undefined && !(Number.isFinite(s.volume) && s.volume >= 0 && s.volume <= 1)) return 'volume between 0 and 1';
  return null;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Reads the manifest's `sound` section. err(code, at, message, extra) reports model diagnostics.
 * Returns {
 *   moment(name) → list of engine feedback actions (empty when muted),
 *   volume (master, 0..1), scale(action) → the action with its volume scaled,
 *   music: {asset, presentation} | null,
 *   clips: {assets: {clip_<i>: {sound}}, ms: [clip lengths], longest_ms},
 * }.
 */
export function compileSound(section, err, warn) {
  const sec = section ?? {};
  const at = '/sound';
  if (section !== undefined && (typeof section !== 'object' || Array.isArray(section) || section === null)) {
    err('A_SOUND_FIELD', at, 'sound must be an object like {"set": "arcade"}');
  }
  for (const k of Object.keys(sec)) if (!['set', 'volume', 'music', 'moments', 'clips'].includes(k)) err('A_SOUND_FIELD', `${at}/${k}`, `sound has no field '${k}' (set, volume, music, moments, clips)`);
  const setName = sec.set ?? 'classic';
  let set = SETS[setName];
  if (!set) { err('A_SOUND_SET', `${at}/set`, `no sound set named '${setName}'`, { hint: `one of ${Object.keys(SETS).join(', ')}` }); set = SETS.classic; }
  let volume = 1;
  if (sec.volume !== undefined) {
    if (!(Number.isFinite(sec.volume) && sec.volume >= 0 && sec.volume <= 1)) err('A_SOUND_FIELD', `${at}/volume`, 'volume is a number from 0 (silent) to 1');
    else volume = sec.volume;
  }
  volume *= set.volume ?? 1;

  const resolved = {};
  for (const m of MOMENTS) resolved[m] = set[m];
  for (const [m, v] of Object.entries(sec.moments ?? {})) {
    const here = `${at}/moments/${m}`;
    if (!MOMENTS.includes(m)) { err('A_SOUND_MOMENT', here, `no moment named '${m}'`, { hint: `moments are ${MOMENTS.join(', ')}` }); continue; }
    if (v === false || v === null) { resolved[m] = null; continue; }
    if (typeof v === 'string') {
      if (!PRESETS[v]) { err('A_SOUND_PRESET', here, `no sound preset named '${v}'`, { hint: `one of ${Object.keys(PRESETS).join(', ')}` }); continue; }
      resolved[m] = v; continue;
    }
    const problem = checkSoundBody(v);
    if (problem) { err('A_SOUND_FIELD', here, `${m} must be ${problem}`); continue; }
    resolved[m] = v;
  }

  const scale = (action) => {
    if (!action?.sound || typeof action.sound !== 'object') return action;
    const v = action.sound.volume;
    if (volume === 1) return action;
    let next;
    if (v === undefined) next = round3(0.6 * volume);
    else if (typeof v === 'number') next = round3(v * volume);
    else if (typeof v === 'string' && v.startsWith('=')) next = `= (${v.slice(1).trim()}) * ${volume}`;
    else next = v;
    return { ...action, sound: { ...action.sound, volume: next } };
  };
  const moment = (name) => {
    const r = resolved[name];
    if (r === null || r === undefined || volume === 0) return [];
    const body = typeof r === 'string' ? PRESETS[r] : r;
    return [scale({ sound: { ...body } })];
  };

  // Music: false/absent → the set's default; true → the set's music (or lullaby); a name → that
  // loop; an object → the model's own loop ({melody, bass, bpm, wave, volume}).
  let musicSpec = null;
  const mv = sec.music;
  if (mv === undefined) musicSpec = set.music ? MUSIC[set.music] : null;
  else if (mv === false || mv === null) musicSpec = null;
  else if (mv === true) musicSpec = MUSIC[set.music ?? 'lullaby'];
  else if (typeof mv === 'string') {
    if (!MUSIC[mv]) err('A_SOUND_PRESET', `${at}/music`, `no music named '${mv}'`, { hint: `one of ${Object.keys(MUSIC).join(', ')}, or true, false, or your own {melody, bass, bpm}` });
    else musicSpec = MUSIC[mv];
  } else if (typeof mv === 'object') {
    const problem = checkMusic(mv);
    if (problem) err('A_SOUND_FIELD', `${at}/music`, `music must be ${problem}`);
    else musicSpec = { ...MUSIC.lullaby, ...mv };
  } else err('A_SOUND_FIELD', `${at}/music`, 'music is true, false, a music name or {melody, bass, bpm}');
  let music = null;
  if (musicSpec && volume > 0) {
    music = {
      asset: { sound: renderMusic(musicSpec) },
      presentation: { asset: 'music', volume: round3((musicSpec.volume ?? 0.3) * volume) },
    };
  }
  // Clips are content (a listen-and-answer round), so they render even when the game's volume is 0.
  const clips = compileClips(sec.clips, err, warn);
  return { moment, scale, volume, music, clips, set: setName };
}

function checkMusic(m) {
  for (const k of Object.keys(m)) if (!['melody', 'bass', 'bpm', 'wave', 'volume'].includes(k)) return `{melody, bass, bpm, wave, volume} (not '${k}')`;
  const okList = (l, max) => Array.isArray(l) && l.length >= 1 && l.length <= max && l.every((n) => n === null || goodNote(n));
  if (m.melody !== undefined && !okList(m.melody, 32)) return 'a melody of 1 to 32 eighth notes (null for a rest)';
  if (m.bass !== undefined && !okList(m.bass, 16)) return 'a bass line of 1 to 16 quarter notes (null for a rest)';
  if (m.bpm !== undefined && !(Number.isFinite(m.bpm) && m.bpm >= 50 && m.bpm <= 180)) return 'bpm from 50 to 180';
  if (m.wave !== undefined && !WAVES.includes(m.wave)) return `wave one of ${WAVES.join(', ')}`;
  if (m.volume !== undefined && !(Number.isFinite(m.volume) && m.volume >= 0 && m.volume <= 1)) return 'volume from 0 to 1';
  return null;
}

// ---------- music rendering: a mono 16-bit 8 kHz WAV loop, as a data: URI ----------

const RATE = 8000;

function osc(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'square': return p < 0.5 ? 0.6 : -0.6;
    case 'triangle': return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 'sawtooth': return (2 * p - 1) * 0.7;
    default: return Math.sin(2 * Math.PI * p);
  }
}

/** Renders a loop ({melody, bass, bpm, wave}) to a `data:audio/wav;base64,...` URI. Deterministic. */
export function renderMusic(spec) {
  const eighth = 30 / spec.bpm; // seconds
  const melody = spec.melody ?? [];
  const bass = spec.bass ?? [];
  const steps = Math.max(melody.length, bass.length * 2, 1);
  const n = Math.round(steps * eighth * RATE);
  const out = new Float64Array(n);
  const voice = (notes, stepSec, wave, gain, decay) => {
    notes.forEach((note, i) => {
      if (note === null || note === undefined) return;
      const hz = noteHz(note);
      const start = Math.round(i * stepSec * RATE);
      const len = Math.round(stepSec * RATE * 0.92);
      for (let k = 0; k < len && start + k < n; k++) {
        const t = k / RATE;
        const attack = Math.min(1, k / (RATE * 0.008));
        const release = Math.min(1, (len - k) / (RATE * 0.02));
        const env = attack * release * Math.exp(-t * decay);
        out[start + k] += osc(wave, hz * t) * env * gain;
      }
    });
  };
  voice(melody, eighth, spec.wave ?? 'sine', 0.38, 3.0);
  voice(bass, eighth * 2, 'triangle', 0.32, 1.6);
  const bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, out[i])) * 32767), true);
  return 'data:audio/wav;base64,' + base64(bytes);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    s += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    s += c === undefined ? '=' : B64[c & 63];
  }
  return s;
}
