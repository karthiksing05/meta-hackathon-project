# Binary frame format (`mg_frame_bin`), v0.2

The fast path from the engine to the shell. It carries the same data as the
JSON frame (`mg_frame_json`), as a little-endian stream of 4-byte words.
Encoder: `crates/mg-wasm/src/encode.rs`. Decoder: `decodeFrame` in
`web/microgame.js`. A Rust test decoder in `encode.rs` round-trips every op
and sound kind.

Every field is one 4-byte word: `u32` (unsigned int) or `f32` (float).
Colors are `u32` packed as `0xRRGGBBAA`; `0` means "none" (no fill, no stroke).

v0.2 changed the magic to `MGF2` and the header to 13 words, so a v0.1
decoder fails loudly instead of misreading frames.

## Layout

```
header      13 words
strings     n_strings entries (variable length)
ops         n_ops entries (variable length)
audio       n_audio entries (variable length)
toasts      n_toasts entries, 2 words each
haptics     n_haptics entries, 1 word each
```

### Header

| Word | Type | Field |
|---|---|---|
| 0 | u32 | magic `0x3246474D` (bytes `M G F 2`) |
| 1 | u32 | flags. Bit 0: **reset**. The decoder clears its string table before reading this frame's strings |
| 2 | f32 | canvas width |
| 3 | f32 | canvas height |
| 4 | u32 | background color |
| 5 | f32 | shake amplitude in canvas units (0 = none) |
| 6 | u32 | `n_strings`: new string definitions in this frame |
| 7 | u32 | `n_ops` |
| 8 | u32 | `n_audio` |
| 9 | u32 | `n_toasts` |
| 10 | u32 | `n_haptics` |
| 11 | u32 | music: `0xFFFFFFFF` = the game has no music; else `asset` (bits 0–15) \| `playing` (bit 16) |
| 12 | f32 | music volume (0–1) |

### Strings

Strings (text content, font names, toast text) are sent once and then
referred to by id. Each game has its own table on both sides.

```
u32 id, u32 byte_len, byte_len bytes of UTF-8, zero padding to a multiple of 4
```

Ids are dense and start at 0. A string is defined in the first frame that
uses it; later frames send only its id. When the encoder's table passes 4,096
entries it starts over: the next frame has the reset flag and re-defines every
string it uses. The first frame of every game has the reset flag.
`mg_frame_bin_reset(h)` forces a reset (use it if the decoder lost its table).

### Ops (paint order)

Each op starts with a **head** word: the tag in bits 0–7 and op-specific
flags in bits 8–31.

**Rect** (tag 1, 12 words). `x, y` is the top-left corner.

```
u32 head=1, f32 x, f32 y, f32 w, f32 h, f32 radius, u32 fill, u32 stroke,
f32 stroke_width, f32 rotation, f32 scale, f32 opacity
```

**Circle** (tag 2, 9 words). `x, y` is the center.

```
u32 head=2, f32 x, f32 y, f32 r, u32 fill, u32 stroke, f32 stroke_width, f32 scale, f32 opacity
```

**Text** (tag 3, 13–16 words). `x, y, w, h` is the text box.

```
u32 head=3|flags, f32 x, f32 y, f32 w, f32 h, u32 text_id, f32 size, u32 font_id,
u32 packed, u32 color, f32 rotation, f32 scale, f32 opacity,
[u32 stroke, f32 stroke_width]   if head bit 8 (v0.2.1)
[f32 line_height]                if head bit 9 (v0.2.1)
```

`packed` = `weight` (bits 0–15) | `align` << 16 | `valign` << 24, where
align is 0 left, 1 center, 2 right and valign is 0 top, 1 middle, 2 bottom.

v0.2.1 head flags, so a plain single-line label stays 13 words:

* Bit 8: the text has an outline. `stroke` is drawn under the fill
  (`strokeText` before `fillText`). Without the flag there is no outline;
  `decodeFrame` gives `stroke: 0, stroke_width: 0`.
* Bit 9: the text has several lines. The string holds the lines joined with
  `\n` (already wrapped by the engine for `wrap: true`), drawn
  `line_height` apart, with the block placed in the box by `valign` and each
  line by `align`. Without the flag the decoder sets
  `line_height = size × 1.25`, which is what the engine uses.

The JSON text op always has `line_height`, `stroke` (a color or `null`) and
`stroke_width`. The magic stays `MGF2`: a v0.2 decoder that ignores the text
flags misreads frames with outlined or multi-line text, so always pair the
wasm with the `microgame.js` built next to it.

**Image** (tag 4, 9 words, v0.2). `x, y, w, h` is the box the frame is drawn
into. Head flags: bit 8 `flip_x`, bit 9 `flip_y`.

```
u32 head=4|flags, f32 x, f32 y, f32 w, f32 h, u32 asset | frame << 16,
f32 rotation, f32 scale, f32 opacity
```

`asset` is the id from `mg_assets(h)`. The sheet's source rect for `frame`
is column `frame % cols`, row `floor(frame / cols)`, each cell
`natural_width / cols` by `natural_height / ceil(frames / cols)`.

**Line** (tag 5, 8 words, v0.2). Absolute end points (camera applied).

```
u32 head=5, f32 x1, f32 y1, f32 x2, f32 y2, u32 stroke, f32 stroke_width, f32 opacity
```

**Poly** (tag 6, 6 + 2n words, v0.2). Absolute points. Head flag bit 8:
`closed`.

```
u32 head=6|flags, u32 n_points, u32 fill, u32 stroke, f32 stroke_width, f32 opacity,
then n_points × (f32 x, f32 y)
```

`decodeFrame` gives `points` as a flat `Float32Array` `[x0, y0, x1, y1, ...]`;
the JSON frame gives `[[x0, y0], ...]`.

Rotation is in degrees, clockwise. Rotation and scale apply around the op's
center (the box center for rects, text and images).

### Audio (v0.2)

Each entry starts with a head word: the kind in bits 0–7.

**Synth** (kind 0, 5 + n words): one note, a slide or a jingle.

```
u32 head = 0 | wave << 8 | n_freqs << 16, f32 volume, f32 ms, f32 step_ms,
f32 slide_hz (0 = no slide), then n_freqs × f32 freq_hz
```

`wave`: 0 sine, 1 square, 2 triangle, 3 sawtooth. With one frequency the note
lasts `ms`; with several each lasts `step_ms` (a jingle). `slide_hz` glides the
last note's pitch to that frequency over its duration.

**Sample** (kind 1, 4 words): play a `sound` asset.

```
u32 head = 1 | asset << 16, f32 volume, f32 ms, f32 rate
```

The JSON frame has the same fields: `{kind: "synth", wave, freqs, step_ms,
slide_hz, ms, volume}` and `{kind: "sample", asset, rate, ms, volume}`.

### Toasts (2 words each)

```
u32 text_id, f32 ms
```

### Haptics (1 word each, v0.2)

```
u32 kind: 0 light, 1 medium, 2 heavy, 3 success, 4 warning, 5 error
```

JSON: `"haptics": ["light", ...]`, `"music": {"asset", "volume", "playing"}`
or `null`.

Audio, toasts and haptics hold only what fired since the previous frame call
(JSON or binary). Music is state: it's in every frame.

## Size

A rect is 48 bytes, a text op 52 (60 with an outline, 4 more for several
lines), an image 36, a line 32, and a triangle 48,
with no per-frame string cost after the first frame. Measured averages per
frame (binary vs JSON): Lights Out (27 ops) 1.4 KB vs 4.1 KB, Snake (226 ops)
10.9 KB vs 32 KB, Lantern Ridge (98 ops, images and polys) 4.5 KB vs 16.7 KB,
Orbit Warden (76 ops, lines and polys) 3.0 KB vs 13.4 KB. Binary also needs no
`JSON.parse` and encodes 10 to 30 times faster. Measured numbers are in
`engine/README.md`.
