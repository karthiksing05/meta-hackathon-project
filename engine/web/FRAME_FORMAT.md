# Binary frame format (`mg_frame_bin`)

The fast path from the engine to the shell. It carries the same data as the
B4 JSON frame (`mg_frame_json`), as a little-endian stream of 4-byte words.
Encoder: `crates/mg-wasm/src/encode.rs`. Decoder: `decodeFrame` in
`web/microgame.js`.

Every field is one 4-byte word: `u32` (unsigned int) or `f32` (float).
Colors are `u32` packed as `0xRRGGBBAA`; `0` means "none" (no fill, no stroke).

## Layout

```
header      10 words
strings     n_strings entries (variable length)
ops         n_ops entries
audio       n_audio entries, 3 words each
toasts      n_toasts entries, 2 words each
```

### Header

| Word | Type | Field |
|---|---|---|
| 0 | u32 | magic `0x3146474D` (bytes `M G F 1`) |
| 1 | u32 | flags. Bit 0: **reset**. The decoder clears its string table before reading this frame's strings |
| 2 | f32 | canvas width |
| 3 | f32 | canvas height |
| 4 | u32 | background color |
| 5 | f32 | shake amplitude in canvas units (0 = none) |
| 6 | u32 | `n_strings`: new string definitions in this frame |
| 7 | u32 | `n_ops` |
| 8 | u32 | `n_audio` |
| 9 | u32 | `n_toasts` |

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

Each op starts with a `u32` tag.

**Rect** (tag 1, 12 words). `x, y` is the top-left corner.

```
u32 tag=1, f32 x, f32 y, f32 w, f32 h, f32 radius, u32 fill, u32 stroke,
f32 stroke_width, f32 rotation, f32 scale, f32 opacity
```

**Circle** (tag 2, 9 words). `x, y` is the center.

```
u32 tag=2, f32 x, f32 y, f32 r, u32 fill, u32 stroke, f32 stroke_width, f32 scale, f32 opacity
```

**Text** (tag 3, 13 words). `x, y, w, h` is the text box.

```
u32 tag=3, f32 x, f32 y, f32 w, f32 h, u32 text_id, f32 size, u32 font_id,
u32 packed, u32 color, f32 rotation, f32 scale, f32 opacity
```

`packed` = `weight` (bits 0–15) | `align` << 16 | `valign` << 24, where
align is 0 left, 1 center, 2 right and valign is 0 top, 1 middle, 2 bottom.

Rotation is in degrees, clockwise. Rotation and scale apply around the op's
center (the box center for rects and text).

### Audio (3 words each)

```
u32 wave (0 sine, 1 square, 2 triangle, 3 sawtooth), f32 freq_hz, f32 ms
```

### Toasts (2 words each)

```
u32 text_id, f32 ms
```

Audio and toasts hold only what fired since the previous frame call (JSON or
binary).

## Size

A rect is 48 bytes and a text op is 52 bytes, with no per-frame string cost
after the first frame. Measured averages per frame (binary vs JSON):
Lights Out (27 ops) 1.3 KB vs 4.1 KB, Snake (226 ops) 10.9 KB vs 32 KB,
Number Merge (34 ops, 17 of them text) 1.7 KB vs 6.1 KB. Binary also needs no
`JSON.parse` and encodes 5 to 20 times faster. Measured numbers are in `engine/README.md`.
