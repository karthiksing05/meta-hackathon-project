# Bundled game fonts

Small web-font library for the game renderer. Fonts come from the google/fonts repo (SIL OFL 1.1 or Apache 2.0 only).

- `fonts.json`: per family id: CSS family name, role, license, source, designer, copyright, files by weight, byte size, `caps_only`, `mono`.
- `metrics.json`: per id and weight: units per em, ascent/descent/cap/x height in em, advance widths in em (kerning ignored) for ASCII plus a few punctuation glyphs, `avg` and `avg_caps` advance, `digits_tabular`.
- `licenses/<id>.txt`: license text for each family (M PLUS Rounded 1c ships no license file in google/fonts; the sibling M+ `OFL.txt` is used).
- `authoring/kit/make-fonts.mjs` writes `game-fonts.css` (with `local()` system fallbacks per face) and `authoring/kit/font-data.mjs` from these two files; the vibe table that pairs them is `authoring/kit/vibes.mjs`.
- The shipped files live in `FacebookClone/Bubbles/Runtime/web/gamefont-<id>-<weight>.woff2` (italic: `<weight>i`), registered in `game-fonts.css` in the same folder.
  Two-weight families register regular as `font-weight: 100 599` and bold as `600 900`; single-weight families use `100 900` so the browser never fakes bold.
  Barlow Condensed BoldItalic is registered as its own family, "Barlow Condensed Italic".

## How the files were built

1. Source `.ttf` files were fetched from `https://raw.githubusercontent.com/google/fonts/main/<ofl|apache>/<family dir>/<file>` (METADATA.pb for designer and copyright).
2. Variable fonts were instanced to a static weight with `fontTools.varLib.instancer.instantiateVariableFont(font, {"wght": W, other axes: default, "ital": 0})`.
3. Every font was subset with `fontTools.subset` (python3, fontTools 4.55, brotli):
   `--unicodes=U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+200A,U+2009,U+20AC,U+2122,U+00D7,U+2190-2193,U+2605,U+2665 --layout-features=kern,liga,tnum,lnum,ccmp,locl,mark,mkmk --no-hinting --flavor=woff2`
4. Metrics were read from the subset font's `hmtx`/`hhea` tables; cap and x height are the bounds of `H` and `x`.

## Families

| id | family | role | license | weights | source |
|---|---|---|---|---|---|
| bungee | Bungee | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/bungee |
| monoton | Monoton | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/monoton |
| righteous | Righteous | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/righteous |
| bowlby | Bowlby One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/bowlbyone |
| press_start | Press Start 2P | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/pressstart2p |
| vt323 | VT323 | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/vt323 |
| silkscreen | Silkscreen | display | OFL-1.1 | 400, 700 | https://github.com/google/fonts/tree/main/ofl/silkscreen |
| creepster | Creepster | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/creepster |
| dm_serif | DM Serif Display | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/dmserifdisplay |
| playfair | Playfair Display | display | OFL-1.1 | 800 | https://github.com/google/fonts/tree/main/ofl/playfairdisplay |
| orbitron | Orbitron | display | OFL-1.1 | 800 | https://github.com/google/fonts/tree/main/ofl/orbitron |
| unifraktur | UnifrakturMaguntia | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/unifrakturmaguntia |
| uncial | Uncial Antiqua | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/uncialantiqua |
| cinzel | Cinzel | display | OFL-1.1 | 700 | https://github.com/google/fonts/tree/main/ofl/cinzel |
| chewy | Chewy | display | Apache-2.0 | 400 | https://github.com/google/fonts/tree/main/apache/chewy |
| archivo_black | Archivo Black | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/archivoblack |
| syne | Syne | display | OFL-1.1 | 800 | https://github.com/google/fonts/tree/main/ofl/syne |
| audiowide | Audiowide | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/audiowide |
| michroma | Michroma | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/michroma |
| bangers | Bangers | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/bangers |
| dela_gothic | Dela Gothic One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/delagothicone |
| teko | Teko | display | OFL-1.1 | 600 | https://github.com/google/fonts/tree/main/ofl/teko |
| alfa_slab | Alfa Slab One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/alfaslabone |
| rye | Rye | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/rye |
| lobster | Lobster | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/lobster |
| pacifico | Pacifico | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/pacifico |
| abril | Abril Fatface | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/abrilfatface |
| poiret | Poiret One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/poiretone |
| special_elite | Special Elite | display | Apache-2.0 | 400 | https://github.com/google/fonts/tree/main/apache/specialelite |
| oswald | Oswald | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/oswald |
| space_mono | Space Mono | text | OFL-1.1 | 400, 700 | https://github.com/google/fonts/tree/main/ofl/spacemono |
| share_tech_mono | Share Tech Mono | text | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/sharetechmono |
| im_fell | IM Fell English | text | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/imfellenglish |
| cormorant | Cormorant Garamond | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/cormorantgaramond |
| fredoka | Fredoka | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/fredoka |
| baloo | Baloo 2 | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/baloo2 |
| patrick_hand | Patrick Hand | text | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/patrickhand |
| nunito | Nunito | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/nunito |
| caveat | Caveat | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/caveat |
| space_grotesk | Space Grotesk | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/spacegrotesk |
| archivo | Archivo | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/archivo |
| mplus_rounded | M PLUS Rounded 1c | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/mplusrounded1c |
| barlow_cond | Barlow Condensed | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/barlowcondensed |
| lora | Lora | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/lora |
| josefin | Josefin Sans | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/josefinsans |
| courier_prime | Courier Prime | text | OFL-1.1 | 400, 700 | https://github.com/google/fonts/tree/main/ofl/courierprime |
| libre_baskerville | Libre Baskerville | text | OFL-1.1 | 400, 700 | https://github.com/google/fonts/tree/main/ofl/librebaskerville |
| dm_sans | DM Sans | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/dmsans |
| work_sans | Work Sans | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/worksans |
| rubik | Rubik | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/rubik |
| outfit | Outfit | text | OFL-1.1 | 500, 700 | https://github.com/google/fonts/tree/main/ofl/outfit |
| barlow_cond_italic | Barlow Condensed Italic | display | OFL-1.1 | 700 | https://github.com/google/fonts/tree/main/ofl/barlowcondensed |
| lilita | Lilita One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/lilitaone |
| bagel | Bagel Fat One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/bagelfatone |
| shrikhand | Shrikhand | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/shrikhand |
| rubik_mono | Rubik Mono One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/rubikmonoone |
| luckiest | Luckiest Guy | display | Apache-2.0 | 400 | https://github.com/google/fonts/tree/main/apache/luckiestguy |
| permanent_marker | Permanent Marker | display | Apache-2.0 | 400 | https://github.com/google/fonts/tree/main/apache/permanentmarker |
| titan | Titan One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/titanone |
| black_ops | Black Ops One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/blackopsone |
| bungee_shade | Bungee Shade | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/bungeeshade |
| faster | Faster One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/fasterone |
| nosifer | Nosifer | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/nosifer |
| pirata | Pirata One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/pirataone |
| knewave | Knewave | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/knewave |
| zen_dots | Zen Dots | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/zendots |
| cherry_bomb | Cherry Bomb One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/cherrybombone |
| metal_mania | Metal Mania | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/metalmania |
| boogaloo | Boogaloo | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/boogaloo |
| racing_sans | Racing Sans One | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/racingsansone |
| sedgwick | Sedgwick Ave Display | display | OFL-1.1 | 400 | https://github.com/google/fonts/tree/main/ofl/sedgwickavedisplay |
