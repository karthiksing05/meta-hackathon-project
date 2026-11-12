// microgame.js: loader and wrapper for the microgame engine (microgame.wasm).
// Plain ES module, no dependencies. Works in browsers and in Node 18+.
//
//   const engine = await Microgame.init('pkg/microgame.wasm');
//   const diags  = engine.validate(json);           // Diagnostic[]
//   const game   = engine.load(json, seed);         // Game, or throws MicrogameLoadError
//   game.pointer('down', x, y); game.keyEvent(e.code, e.key, true); game.swipe('left');
//   game.text('submit', 'hello'); game.assets(); game.log();
//   game.step(16); const frame = game.frame();      // binary fast path, decoded
//   game.status(); game.restart(); game.dispose();
//
// `Microgame.validate(json)` and `Microgame.load(json, seed)` also work as
// static calls once `init` has run (they use the last initialized engine).

const utf8enc = new TextEncoder();
const utf8dec = new TextDecoder();

const ERR_INVALID = -1;
const PHASES = ['playing', 'won', 'lost'];
const POINTER_KINDS = { down: 0, move: 1, up: 2 };
const SWIPES = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export class MicrogameLoadError extends Error {
  constructor(diagnostics) {
    const first = diagnostics.find((d) => d.severity === 'error') || diagnostics[0];
    super(first ? `${first.code} at ${first.at || '/'}: ${first.message}` : 'invalid game');
    this.name = 'MicrogameLoadError';
    this.diagnostics = diagnostics;
  }
}

export class MicrogameCrash extends Error {
  constructor(message) {
    super(`engine crashed: ${message || 'unknown error'}`);
    this.name = 'MicrogameCrash';
  }
}

export class Microgame {
  /** source: URL string, URL, Response, ArrayBuffer, typed array or WebAssembly.Module. */
  static async init(source = new URL('./pkg/microgame.wasm', import.meta.url)) {
    let instance;
    if (source instanceof WebAssembly.Module) {
      instance = await WebAssembly.instantiate(source, {});
    } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      ({ instance } = await WebAssembly.instantiate(source, {}));
    } else {
      const res = source instanceof Response ? source : await fetch(source);
      if (!res.ok) throw new Error(`could not fetch ${res.url}: ${res.status}`);
      if (WebAssembly.instantiateStreaming && res.headers.get('content-type') === 'application/wasm') {
        ({ instance } = await WebAssembly.instantiateStreaming(res, {}));
      } else {
        ({ instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {}));
      }
    }
    const engine = new Microgame(instance.exports);
    Microgame.default = engine;
    return engine;
  }

  static validate(json) { return requireDefault().validate(json); }
  static load(json, seed) { return requireDefault().load(json, seed); }

  constructor(exports) {
    this.x = exports;
    this.x.mg_init();
  }

  /** Bytes of the last result as a Uint8Array view (valid until the next call). */
  _resultBytes(len) {
    return new Uint8Array(this.x.memory.buffer, this.x.mg_result_ptr(), len);
  }
  _resultString(len) { return len > 0 ? utf8dec.decode(this._resultBytes(len)) : ''; }
  _resultJSON(len) { return JSON.parse(this._resultString(len)); }

  /** Copies bytes into wasm memory, calls fn(ptr, len), frees. */
  _withBytes(bytes, fn) {
    const ptr = this.x.mg_alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    try {
      return fn(ptr, bytes.length);
    } finally {
      this.x.mg_free(ptr, bytes.length);
    }
  }

  validate(json) {
    const bytes = utf8enc.encode(typeof json === 'string' ? json : JSON.stringify(json));
    const len = this._withBytes(bytes, (p, n) => this.x.mg_validate(p, n));
    return this._resultJSON(len);
  }

  /** seed: number, or undefined for `meta.seed` (or the engine default). */
  load(json, seed) {
    const bytes = utf8enc.encode(typeof json === 'string' ? json : JSON.stringify(json));
    let handle;
    try {
      handle = this._withBytes(bytes, (p, n) => this.x.mg_load(p, n, seed ?? NaN));
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) throw new MicrogameCrash(this.panicMessage() || e.message);
      throw e;
    }
    if (handle === ERR_INVALID) throw new MicrogameLoadError(this._resultJSON(this.x.mg_result_len()));
    if (handle < 0) throw new Error(`load failed (${handle})`);
    return new Game(this, handle);
  }

  panicMessage() { return this._resultString(this.x.mg_panic_message()); }
  liveGames() { return this.x.mg_live_games(); }
}

function requireDefault() {
  if (!Microgame.default) throw new Error('call `await Microgame.init(url)` first');
  return Microgame.default;
}

export class Game {
  constructor(engine, handle) {
    this.engine = engine;
    this.handle = handle;
    this.crashed = null;
    this.strings = [];          // binary frame string table (see FRAME_FORMAT.md)
    this._frame = newFrame();   // reused between frame() calls
    this._meta = null;
  }

  _call(fn) {
    if (this.handle < 0) throw new Error(this.crashed ? `game crashed: ${this.crashed}` : 'game was disposed');
    try {
      const r = fn(this.engine.x, this.handle);
      if (r === -2) throw new Error('invalid game handle');
      return r;
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) {
        // A trap: drop this game without running its destructors. Other
        // games in the same engine keep working.
        this.crashed = this.engine.panicMessage() || e.message;
        this.engine.x.mg_forget(this.handle);
        this.handle = -1;
        throw new MicrogameCrash(this.crashed);
      }
      throw e;
    }
  }

  get meta() {
    if (!this._meta) this._meta = this.engine._resultJSON(this._call((x, h) => x.mg_meta(h)));
    return this._meta;
  }

  /** kind: 'down' | 'move' | 'up' (or 0/1/2). x, y in canvas units. */
  pointer(kind, x, y) {
    const k = typeof kind === 'number' ? kind : POINTER_KINDS[kind];
    if (k === undefined) throw new Error(`bad pointer kind ${kind}`);
    this._call((m, h) => m.mg_pointer(h, k, x, y));
  }

  /**
   * v0.2 full keyboard event. code: KeyboardEvent.code; key: KeyboardEvent.key
   * (only single printable characters are passed on as `char`); down: true
   * for keydown, false for keyup. Returns true if it matched an input.
   */
  keyEvent(code, key, down = true) {
    const ch = typeof key === 'string' && [...key].length === 1 ? key : '';
    const c = utf8enc.encode(code || ''), k = utf8enc.encode(ch);
    return this._call((m, h) => this.engine._withBytes(c, (cp, cn) =>
      this.engine._withBytes(k, (kp, kn) => m.mg_key_event(h, cp, cn, kp, kn, down ? 1 : 0)))) === 1;
  }

  /** v0.2 text field. kind: 'submit' | 'change'. Returns true if it matched an input. */
  text(kind, value) {
    const k = kind === 'submit' || kind === 0 ? 0 : 1;
    const bytes = utf8enc.encode(String(value ?? ''));
    return this._call((m, h) => this.engine._withBytes(bytes, (p, n) => m.mg_text(h, k, p, n))) === 1;
  }

  /** v0.2 assets: [{id, name, kind: 'image'|'sound', src, svg, w, h, frames, cols, fps}]. */
  assets() { return this.engine._resultJSON(this._call((m, h) => m.mg_assets(h))); }

  /**
   * The input log since load or restart (`microgame-log/1`), with the current
   * result as `final`. `microgame verify game.json --log log.json` checks it.
   * Pass `raw = true` for the JSON string.
   */
  log(raw = false) {
    const s = this.engine._resultString(this._call((m, h) => m.mg_log(h)));
    return raw ? s : JSON.parse(s);
  }

  /** Tries each name in order (pass KeyboardEvent.code, then .key). Returns true if one matched. */
  key(...names) {
    for (const name of names) {
      if (!name) continue;
      const bytes = utf8enc.encode(name);
      const r = this._call((m, h) => this.engine._withBytes(bytes, (p, n) => m.mg_key(h, p, n)));
      if (r === 1) return true;
    }
    return false;
  }

  /** dir: 'left' | 'right' | 'up' | 'down', or (dx, dy). Returns true if it matched an input. */
  swipe(dir, dy) {
    const [dx, ddy] = typeof dir === 'string' ? (SWIPES[dir] || [0, 0]) : [dir, dy];
    return this._call((m, h) => m.mg_swipe(h, Math.sign(dx) | 0, Math.sign(ddy) | 0)) === 1;
  }

  /** Advances the game; returns the phase ('playing' | 'won' | 'lost'). */
  step(dtMs) { return PHASES[this._call((m, h) => m.mg_step(h, dtMs))]; }

  phase() { return PHASES[this._call((m, h) => m.mg_phase(h))]; }

  /** Binary fast path, decoded. The returned object is reused by the next call. */
  frame() {
    const len = this._call((m, h) => m.mg_frame_bin(h));
    const x = this.engine.x;
    const view = new DataView(x.memory.buffer, x.mg_result_ptr(), len);
    return decodeFrame(view, this.strings, this._frame);
  }

  /**
   * Raw binary frame bytes (a copy). Also decodes them into this game's
   * string table, which must see every frame to stay in sync.
   */
  frameBytes() {
    const len = this._call((m, h) => m.mg_frame_bin(h));
    const bytes = this.engine._resultBytes(len).slice();
    decodeFrame(new DataView(bytes.buffer), this.strings);
    return bytes;
  }

  /** The B4 JSON frame (slower; for debugging and tests). */
  frameJSON() { return this.engine._resultJSON(this._call((m, h) => m.mg_frame_json(h))); }

  status() { return this.engine._resultJSON(this._call((m, h) => m.mg_status(h))); }

  /** seed: number, or undefined to reuse the current seed. */
  restart(seed) {
    this._call((m, h) => m.mg_restart(h, seed ?? NaN));
    this._meta = null;
  }

  /**
   * An independent copy of this game (state, scene and input log), e.g. for a
   * bot to try a move and look ahead. Cheap. Dispose of it when done.
   */
  fork() {
    const h = this._call((m, h) => m.mg_fork(h));
    if (h < 0) throw new MicrogameCrash(`fork failed (${h})`);
    return new Game(this.engine, h);
  }

  state() { return this.engine._resultJSON(this._call((m, h) => m.mg_state_json(h))); }
  stateHash() { return this.engine._resultString(this._call((m, h) => m.mg_state_hash(h))); }
  /** Runtime diagnostics since the last call. */
  diagnostics() { return this.engine._resultJSON(this._call((m, h) => m.mg_diagnostics(h))); }

  dispose() {
    if (this.handle >= 0) this.engine.x.mg_unload(this.handle);
    this.handle = -1;
  }
}

// ------------------------------------------------------- binary frames ----

const MAGIC = 0x3246474d; // "MGF2"
const ALIGN = ['left', 'center', 'right'];
const VALIGN = ['top', 'middle', 'bottom'];
const WAVES = ['sine', 'square', 'triangle', 'sawtooth'];
const HAPTICS = ['light', 'medium', 'heavy', 'success', 'warning', 'error'];

function newFrame() {
  return { width: 0, height: 0, background: 0, shake: 0, ops: [], audio: [], toasts: [], haptics: [], music: null,
    _pool: [] };
}

/**
 * Decodes one binary frame (format: FRAME_FORMAT.md).
 * view: DataView over the frame bytes. strings: the game's string table
 * (an array, updated in place). out: a frame object to reuse (optional).
 * Colors are 0xRRGGBBAA numbers; 0 means none. Op objects are pooled.
 */
export function decodeFrame(view, strings, out = newFrame()) {
  let o = 0;
  const u32 = () => { const v = view.getUint32(o, true); o += 4; return v; };
  const f32 = () => { const v = view.getFloat32(o, true); o += 4; return v; };
  if (u32() !== MAGIC) throw new Error('not a microgame frame');
  const flags = u32();
  out.width = f32();
  out.height = f32();
  out.background = u32();
  out.shake = f32();
  const nStrings = u32(), nOps = u32(), nAudio = u32(), nToasts = u32(), nHaptics = u32();
  const musicWord = u32(), musicVolume = f32();
  out.music = musicWord === 0xffffffff ? null
    : { asset: musicWord & 0xffff, playing: (musicWord >>> 16 & 1) === 1, volume: musicVolume };
  if (flags & 1) strings.length = 0;
  for (let i = 0; i < nStrings; i++) {
    const id = u32(), len = u32();
    strings[id] = utf8dec.decode(new Uint8Array(view.buffer, view.byteOffset + o, len));
    o += (len + 3) & ~3;
  }
  const pool = out._pool || (out._pool = []);
  out.ops.length = nOps;
  for (let i = 0; i < nOps; i++) {
    const op = pool[i] || (pool[i] = {});
    const head = u32();
    const tag = head & 0xff;
    if (tag === 1) {
      op.op = 'rect';
      op.x = f32(); op.y = f32(); op.w = f32(); op.h = f32(); op.radius = f32();
      op.fill = u32(); op.stroke = u32(); op.stroke_width = f32();
      op.rotation = f32(); op.scale = f32(); op.opacity = f32();
    } else if (tag === 2) {
      op.op = 'circle';
      op.x = f32(); op.y = f32(); op.r = f32();
      op.fill = u32(); op.stroke = u32(); op.stroke_width = f32();
      op.rotation = 0; op.scale = f32(); op.opacity = f32();
    } else if (tag === 3) {
      op.op = 'text';
      op.x = f32(); op.y = f32(); op.w = f32(); op.h = f32();
      op.text = strings[u32()]; op.size = f32(); op.font = strings[u32()];
      const packed = u32();
      op.weight = packed & 0xffff; op.align = ALIGN[(packed >>> 16) & 0xff]; op.valign = VALIGN[packed >>> 24];
      op.color = u32(); op.rotation = f32(); op.scale = f32(); op.opacity = f32();
      // v0.2.1 head flags: bit 8 an outline, bit 9 several lines.
      if (head & 0x100) { op.stroke = u32(); op.stroke_width = f32(); } else { op.stroke = 0; op.stroke_width = 0; }
      op.line_height = (head & 0x200) ? f32() : op.size * 1.25;
    } else if (tag === 4) {
      op.op = 'image';
      op.x = f32(); op.y = f32(); op.w = f32(); op.h = f32();
      const af = u32();
      op.asset = af & 0xffff; op.frame = af >>> 16;
      op.flip_x = (head & 0x100) !== 0; op.flip_y = (head & 0x200) !== 0;
      op.rotation = f32(); op.scale = f32(); op.opacity = f32();
    } else if (tag === 5) {
      op.op = 'line';
      op.x1 = f32(); op.y1 = f32(); op.x2 = f32(); op.y2 = f32();
      op.stroke = u32(); op.stroke_width = f32(); op.opacity = f32();
      op.rotation = 0; op.scale = 1;
    } else if (tag === 6) {
      op.op = 'poly';
      op.closed = (head & 0x100) !== 0;
      const n = u32();
      op.fill = u32(); op.stroke = u32(); op.stroke_width = f32(); op.opacity = f32();
      const pts = op.points instanceof Float32Array && op.points.length === 2 * n ? op.points : new Float32Array(2 * n);
      for (let k = 0; k < 2 * n; k++) pts[k] = f32();
      op.points = pts; // flat [x0, y0, x1, y1, ...]
      op.rotation = 0; op.scale = 1;
    } else {
      throw new Error(`bad op tag ${tag} at byte ${o - 4}`);
    }
    out.ops[i] = op;
  }
  out.audio.length = 0;
  for (let i = 0; i < nAudio; i++) {
    const head = u32();
    const volume = f32(), ms = f32();
    if ((head & 0xff) === 1) {
      out.audio.push({ kind: 'sample', asset: head >>> 16, volume, ms, rate: f32() });
    } else {
      const step_ms = f32(), slide = f32();
      const freqs = [];
      for (let k = 0, n = head >>> 16; k < n; k++) freqs.push(f32());
      out.audio.push({ kind: 'synth', wave: WAVES[(head >>> 8) & 0xff] || 'sine', freqs, step_ms,
        slide_hz: slide > 0 ? slide : null, ms, volume });
    }
  }
  out.toasts.length = 0;
  for (let i = 0; i < nToasts; i++) out.toasts.push({ text: strings[u32()], ms: f32() });
  out.haptics.length = 0;
  for (let i = 0; i < nHaptics; i++) out.haptics.push(HAPTICS[u32()] || 'light');
  return out;
}

/** 0xRRGGBBAA → '#RRGGBB' or '#RRGGBBAA' (same as the engine's JSON frames). */
export function rgbaToHex(c) {
  const hex = (c >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return hex.endsWith('FF') ? `#${hex.slice(0, 6)}` : `#${hex}`;
}

const cssCache = new Map();
/** 0xRRGGBBAA → CSS color string (cached). */
export function rgbaToCss(c) {
  let s = cssCache.get(c);
  if (s === undefined) {
    const a = (c & 0xff) / 255;
    s = a === 1 ? rgbaToHex(c) : `rgba(${c >>> 24},${(c >>> 16) & 0xff},${(c >>> 8) & 0xff},${+a.toFixed(3)})`;
    if (cssCache.size > 4096) cssCache.clear();
    cssCache.set(c, s);
  }
  return s;
}
