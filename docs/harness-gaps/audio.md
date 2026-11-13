# Gap: audio as game content

Status: **built for original music** (melody clips, the `play_clip` fragment, catalog types and checklists).
Recorded sounds (animals, voices, real instruments, sound effects) are still a gap, owned by Artem and Max.

## Who needs it

| Request | Before | Now |
|---|---|---|
| Kevin #20: "Guess the decade game where I hear a short synth melody and pick the era it sounds like" | Planned well (quiz + rounds), but the only sound a question could play was a one-wave jingle with even steps, with no chords, drums or timbre. That can't sound like a decade | `era_by_ear_quiz`: `melody_clip` + `play_clip` + `quiz`. Example: `authoring/games/guess_the_decade.authoring.json` passes the gate |
| Which instrument | `audio_clip` (planned) | `melody_clip` with `lead_sound` (piano, organ, flute, strings, brass, bell, pluck and others) |
| Name that tune | Real songs can't be used | `tune_recall_snippet`: the game teaches its own jingles, then plays snippets |
| Sound-matching memory | none | `sound_pairs_memory` (memory family): `match_pairs`, with the game playing `clip_<symbol>` on a flip |
| Simon-like copy the riff, pitch match, higher or lower, intervals, rhythm tap | Already worked with synth notes (`sequence_memory`, `synth_sound`, `beat_target`) | Unchanged. `plain`-style clips add real chords if wanted |
| Guess the sound effect, bird calls, spoken words | gap | Still a gap: needs recordings (`audio_clip`, Requests) |

## What the stack could already do (read from the code)

- **Engine** (`engine/SPEC-v0.2.md` §6, `mg-scene/src/build.rs`): a feedback `sound` can be a sample,
  `{ "asset": … }`, and **`asset` can be an expression** (`fb_asset` evaluates it per event). A game can
  already play a different clip for each question, with no engine change. `sound` assets are `data:` or
  `https:` URIs of up to 4 MB each. Jingles take up to 256 notes, but they have one wave and one step
  length.
- **Runtime** (`engine/web/render.js`, `bubble-kit-microgame.js`): samples play through Web Audio
  (`playSample`) and are decoded once by `AssetStore`. The master bus low-passes at 6 kHz, which is why
  clips are rendered at 11,025 Hz. Fast-forward (replays, bots) plays no audio.
- **Expander** (`sound.mjs`): sound sets, moment presets and one music loop rendered to an 8 kHz WAV
  (one wave plus a triangle bass). There was no per-question content.
- **Replays**: audio is only in frames. The engine never reads it back into state, so audio timing can't
  change a score. The new test checks this: replacing every clip with silence gives the same state hash
  and the same score.
- **iOS** (`GameSound.swift`): app cues and Studio previews only. Games play through Web Audio in the
  web view while `beginGamePlayback` holds `.playback`.

## Options

| | What | Cost | Needs | Replay risk |
|---|---|---|---|---|
| **A. Notation → WAV at build time (built)** | Muse writes notes, chords, a style and drums; the expander renders WAV assets `clip_<i>` | Done: about 1 day. Game size is about 30 KB per second of clip, or 15 KB at 8-bit (Guess the Decade: 10 clips of 2 bars is 683 KB of game JSON) | Nothing to ship. Two runtime fixes would help (Requests) | None. Presentation only, and the bytes are pinned |
| B. Notation as a runtime asset kind | The same notation, rendered in the web runtime when the game loads (`{"melody": {...}}` asset) | About 1–2 days for Artem, plus the engine asset validator | Artem: a new asset kind, and the renderer in the runtime bundle | None, if it's the same deterministic renderer. Games shrink to about 200 B per clip |
| C. Server-rendered or library clips | The server renders, or picks from a CC0 library, and stores the file at a URL | 2–3 days. Storage, a CDN and licence records | Max: storage and an endpoint. Artem: https assets in the app | None. But URLs can rot, so pin a hash |

**Recommendation:** ship A now (done). Plan B if game size becomes a problem; the notation and the
renderer move as they are. Do C only for recorded sounds (Kevin's sound-library idea), keeping the same
`clip_<i>` asset contract, so `play_clip` and the game's feedback don't change.

## What was built

- `authoring/expander/melody.mjs`: notation parser and checker, 10 era styles, 22 instruments, 10
  grooves, 7 comping and 7 bass patterns, and room, tape-wow, lowpass, hiss, crackle and bit-crush
  colour. Output is a mono PCM WAV at 11,025 Hz (16-bit, or 8-bit with a fixed dither past 30 s of clips
  in one game). It uses a polynomial sine, a series exp and an xorshift PRNG, so **Node and
  JavaScriptCore give byte-identical output** (tested). Limits: 12 clips, each under 10 s, all under 80 s.
- `sound.clips` in the manifest (`sound.mjs` and a 3-line hook in `expand.mjs`). Each clip becomes asset
  `clip_<i>`, with errors `A_SOUND_CLIP` at `/sound/clips/<i>/<field>` and the warning `W_CLIP_TRIMMED`.
  Documented in `authoring/SPEC.md` 2.9.
- `authoring/fragments/play_clip.fragment.json`: plays clip `order[qi] % clips` 600 ms after each quiz
  question appears, and draws a **Play again** pill (limited replays, locked while a clip is playing,
  with a progress fill). It emits `clip_play {clip}`.
- `authoring/games/guess_the_decade.authoring.json`: Kevin #20, 10 rounds, with clips written by
  `muse-wonder-1.0`. **Passes the five-bot gate** (2 lost, 3 won, scores 700–1000).
- Catalog:
  - `melody_clip` (content tool, shipped) and `play_clip` (fragment).
  - Updated `audio_clip_player`, and `audio_clip` (still planned, for recordings, with a compatible API).
  - New types `era_by_ear_quiz`, `tune_recall_snippet` and `sound_pairs_memory`.
  - `name_that_instrument`, `instrument_by_ear` and `rhythm_name_that_tune` now use melody clips.
  - New checklists `music_making.json` (default plus an `era_by_ear_quiz` override) and
    `rhythm_music.json`, and 4 eval cases. Kevin #20 retrieves `era_by_ear_quiz`. Overall retrieval
    recall@5 is unchanged at 0.94.
- Tools:
  - `authoring/tools/render-clip.mjs` writes WAVs to listen to (`--styles` for one demo per style).
  - `authoring/tools/test-melody.mjs` has 68 checks: notation errors, same input gives the same bytes,
    pinned hashes, JSC equals Node, the expander, and in the engine the right clip per question,
    replays limited, the same state with silent clips.

## Real-Muse test (honest)

Two `muse-wonder-1.0` calls (about 52 s and 7–8 k tokens each, mostly reasoning) wrote 16 clips. Clips and
WAVs are in the scratchpad, `audio-gap/muse/`.

- **Notation:** 16/16 clips parsed and rendered first time. 14/16 filled their bars exactly, and two came
  up 2–4 sixteenths short, which is harmless.
- **Harmony:** every lead note was in key. 60–90% of strong-beat notes were chord tones, which sounds
  like real pop writing.
- **Rhythm:** asked plainly (run 1), Muse wrote straight eighths in every decade (0–2 syncopated notes
  per clip). With era rhythm spelled out (run 2), it wrote real syncopation: 16th-rest disco hooks, dotted
  R&B pushes, offbeat house stabs, a 50s dotted shuffle, and rests between trap plucks.
- **Does it sound like the decade?** I can't listen. What I can say: most of the era identity comes from
  the style preset (the instruments, the drum groove, the gated snare, tape wow, crackle and loudness),
  not from Muse's notes. Synth emulations of 50s and 60s acoustic bands sound like synth emulations; the
  80s, 90s, 00s, 10s and chip styles are synth-native, so they should be the most convincing. The rendered
  clips are louder and brighter for later decades, much like real records. **Someone should listen to
  `audio-gap/styles/*.wav` and `audio-gap/muse/wonder2_*.wav` before the demo.**
- **Originality:** the clips are generic 2–4 bar phrases over common progressions. Muse was told never to
  quote a song. Accidental resemblance to a famous hook is possible but unlikely at this length.

An honest stand-in until recordings exist: original synthesized tunes, said plainly in the plan ("original
tunes in the style of each decade").

## Requests

**Artem (runtime):**
> :wave: Artem — Claude (agent for Karthik) here, from the audio gap (`docs/harness-gaps/audio.md`). Games now ship melody clips as `sound` assets (`clip_0`, `clip_1`, …) and play one per quiz question through feedback `{sound: {asset: "= 'clip_' + str(event.clip)"}}`. Your engine already supports this; thank you. Two runtime asks:
> 1. **Sound assets never load if audio isn't running when the run opens.** `bubble-kit-microgame.js` creates `AssetStore` with `audioCtx: () => audioOut(sdk)?.ctx`, and `fx.audio()` returns null while muted or before the context is running. The sound asset then fails with "no WebAudio" and is never retried, so the run stays silent for its whole length: clips, and today's music loops too. Could the store decode with `Sound.ensure()`'s context even while it's suspended (decodeAudioData works then), or retry failed sound assets once audio becomes available?
> 2. Nice to have: a sample triggered while audio is still locked is dropped. Could the runtime keep the latest one from the last ~1 s and play it on unlock? `play_clip` has a Play again button, so this isn't blocking.
> Later, only if game size matters: a `melody` asset kind the runtime renders at load from the same notation (`authoring/expander/melody.mjs` is pure JS and deterministic), which would cut about 30 KB per clip-second to about 200 bytes per clip. Prompts that need this: Kevin #20, and any which-instrument or name-the-jingle game.

**Max (server):**
> :wave: Max — Claude (agent for Karthik). Games with melody clips carry their audio inline as WAV data URIs. Guess the Decade's `game_json` is about 683 KB, and a game can go up to about 1.2 MB. Could you check the generator's and the API's body-size limits for game uploads and Studio saves, and tell me the ceiling? Second, for Kevin's sound-library idea (Slack, 22:29): when you and Artem build it, please keep the asset contract. A clip could be `{"library": "<sound id>"}` in `sound.clips`; the server resolves it to a URL or data URI and the asset stays `clip_<i>`. Then `play_clip` and the catalog's `audio_clip` entry work unchanged. Sources must be CC0 or licensed, with the source and licence stored per sound.

**Bayan (art):** nothing needed. `play_clip` draws its pill with standard tokens. A `button` sprite role
could come later.

**Group-play agent (prompt owner):** when the plan's tools include `melody_clip`, compose should:
- write `sound.clips`, one per question in content order (SPEC 2.9);
- ask for the era's rhythm explicitly, not straight eighths (this made the difference in the Muse test);
- prefer 2-bar clips;
- set quiz `time_ms` to at least (replays + 1) × the longest clip + 3.6 s.

The 2.11 prompt block's `"sound"` line could gain `"clips": [ {style, bpm, bars, lead, chords} ]`.

## What's left

- Someone listens to the rendered clips and tunes the style presets by ear.
- The two runtime requests above. The first one matters for any game that starts muted.
- Recorded sounds (`audio_clip`): Artem and Max.
- Gold set entry and few-shot pair for Guess the Decade, if the gold owner wants one. It's in
  `authoring/games/`, not in `authoring/gold/`.
