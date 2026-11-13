#!/usr/bin/env node
// Unit tests for the SVG sanitizer, the art and sound sections, sprite roles and their fallbacks.
// Plain Node, no packages: node authoring/expander/test-art-sound.mjs  (exit 1 on any failure).
// With a built engine (see engine.mjs) it also checks that the expanded test games validate.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSvg, composeSheet, SVG_LIMITS } from './svg.mjs';
import { compileSound, PRESETS, SETS, MUSIC, MOMENTS, renderMusic } from './sound.mjs';
import { expand, loadLibrary } from './expand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = loadLibrary(root);
let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const codes = (r) => r.diagnostics.map((d) => d.code);
const findNodes = (node, pred, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((c) => findNodes(c, pred, out));
    else if (v && typeof v === 'object') findNodes(v, pred, out);
  }
  return out;
};
const allActions = (game) => game.presentation.feedback.flatMap((f) => f.do.map((a) => ({ on: f.on, ...a })));

const DOT = "<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4' fill='#F80'/></svg>";

// ---------------------------------------------------------------- sanitizer
console.log('SVG sanitizer');
{
  const good = `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 40 40'>
    <defs>
      <linearGradient id='g'><stop offset='0' stop-color='#fff'/><stop offset='1' stop-color='#000'/></linearGradient>
      <filter id='f'><feGaussianBlur stdDeviation='2'/><feDropShadow dx='1' dy='1' stdDeviation='1'/></filter>
      <pattern id='p' width='4' height='4' patternUnits='userSpaceOnUse'><circle cx='2' cy='2' r='1'/></pattern>
      <clipPath id='c'><rect width='40' height='40' rx='6'/></clipPath>
      <symbol id='s' viewBox='0 0 4 4'><rect width='4' height='4'/></symbol>
    </defs>
    <g clip-path='url(#c)' filter='url(#f)'><rect width='40' height='40' fill='url(#g)'/><rect width='40' height='40' fill="url('#p')"/></g>
    <use href='#s' x='2' y='2' width='8' height='8'/><use xlink:href='#s' x='20' y='2' width='8' height='8'/>
    <text x='20' y='30' style='font-weight: 700; fill: #333'>Hi &amp; bye</text>
    <!-- a comment -->
  </svg>`;
  const r = sanitizeSvg(good);
  ok(r.ok, 'keeps gradients, filters, patterns, clip paths, symbols, use #id and text', r.errors);
  ok(r.viewBox && r.viewBox.w === 40 && r.viewBox.h === 40, 'reads the viewBox', r.viewBox);
  ok(sanitizeSvg(good).svg === good.trim(), 'returns the SVG unchanged when it already has xmlns');
  const bare = sanitizeSvg(DOT);
  ok(bare.ok && bare.svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), 'adds a missing xmlns', bare.svg);
  ok(sanitizeSvg("<svg width='24' height='12'><rect width='24' height='12'/></svg>").viewBox?.w === 24, 'width and height stand in for a viewBox');
  ok(sanitizeSvg("<svg viewBox='0 0 8 8'><image href='data:image/png;base64,iVBORw0KGgo=' width='8' height='8'/></svg>").ok, 'allows <image> with a data:image/png');

  const bad = {
    script: "<svg viewBox='0 0 8 8'><script>alert(1)</script></svg>",
    onload: "<svg viewBox='0 0 8 8' onload='alert(1)'><rect width='8' height='8'/></svg>",
    onclickUpper: "<svg viewBox='0 0 8 8'><rect width='8' height='8' ONCLICK='x()'/></svg>",
    foreignObject: "<svg viewBox='0 0 8 8'><foreignObject width='8' height='8'><div>hi</div></foreignObject></svg>",
    externalHref: "<svg viewBox='0 0 8 8'><use href='https://example.com/a.svg#x'/></svg>",
    xlinkJs: "<svg viewBox='0 0 8 8' xmlns:xlink='http://www.w3.org/1999/xlink'><use xlink:href='javascript:alert(1)'/></svg>",
    entityJs: "<svg viewBox='0 0 8 8'><use href='&#106;avascript:alert(1)'/></svg>",
    externalUrl: "<svg viewBox='0 0 8 8'><rect width='8' height='8' fill='url(https://example.com/p.svg#g)'/></svg>",
    styleUrl: "<svg viewBox='0 0 8 8'><rect width='8' height='8' style='fill: url(//evil.example/x)'/></svg>",
    importCss: "<svg viewBox='0 0 8 8'><style>@import url(#x); rect { fill: red }</style><rect width='8' height='8'/></svg>",
    cdataImport: "<svg viewBox='0 0 8 8'><style><![CDATA[@import 'x.css';]]></style></svg>",
    imageUrl: "<svg viewBox='0 0 8 8'><image href='https://example.com/a.png' width='8' height='8'/></svg>",
    imageSvgData: "<svg viewBox='0 0 8 8'><image href='data:image/svg+xml;base64,PHN2Zz4=' width='8' height='8'/></svg>",
    doctype: "<svg viewBox='0 0 8 8'><!DOCTYPE svg [<!ENTITY a 'b'>]><rect width='8' height='8'/></svg>",
    xmlDecl: "<?xml version='1.0'?><svg viewBox='0 0 8 8'/>",
    smil: "<svg viewBox='0 0 8 8'><rect width='8' height='8'><animate attributeName='x' to='4' dur='1s'/></rect></svg>",
    link: "<svg viewBox='0 0 8 8'><a href='#x'><rect width='8' height='8'/></a></svg>",
    noViewBox: "<svg><rect width='8' height='8'/></svg>",
    unclosed: "<svg viewBox='0 0 8 8'><g><rect width='8' height='8'/></svg>",
    afterRoot: "<svg viewBox='0 0 8 8'></svg><script>x()</script>",
    notSvg: "<div>hi</div>",
    namespaced: "<svg viewBox='0 0 8 8' xmlns:ev='http://www.w3.org/2001/xml-events'><rect ev:event='click' width='8' height='8'/></svg>",
  };
  for (const [name, svg] of Object.entries(bad)) {
    const r2 = sanitizeSvg(svg);
    ok(!r2.ok && r2.errors.length > 0 && r2.svg === null, `rejects ${name}`, r2.errors);
  }
  ok(sanitizeSvg(bad.script).errors.some((e) => /script/.test(e)), 'says why: scripts');
  ok(sanitizeSvg(bad.externalHref).errors.some((e) => /inside the SVG/.test(e)), 'says why: outside href');
  const big = `<svg viewBox='0 0 8 8'>${'<rect width="1" height="1"/>'.repeat(1200)}</svg>`;
  ok(!sanitizeSvg(big).ok && /KB/.test(sanitizeSvg(big).errors[0]), 'rejects an SVG over the sprite limit', sanitizeSvg(big).errors);
  ok(sanitizeSvg(big, { maxBytes: SVG_LIMITS.backdrop_bytes }).ok, 'the backdrop limit is larger');

  const a = sanitizeSvg("<svg viewBox='0 0 10 10'><defs><radialGradient id='g'/></defs><circle r='4' fill='url(#g)'/><use href='#g'/></svg>");
  const b = sanitizeSvg("<svg viewBox='0 0 20 10'><defs><radialGradient id='g'/></defs><rect fill=\"url('#g')\" width='4' height='4'/></svg>");
  const sheet = composeSheet([a, b], 16, 16);
  ok(/id='f0_g'/.test(sheet) && /id='f1_g'/.test(sheet), 'a sheet prefixes each frame\'s ids', sheet);
  ok(/url\(#f0_g\)/.test(sheet) && /url\('#f1_g'\)/.test(sheet) && /href='#f0_g'/.test(sheet), 'and every reference to them');
  ok(/^<svg [^>]*width="32" height="16" viewBox="0 0 32 16">/.test(sheet), 'a sheet is frames × w wide', sheet.slice(0, 160));
  ok(sanitizeSvg(sheet, { maxBytes: 64 * 1024 }).ok, 'a composed sheet passes the sanitizer itself');
}

// ---------------------------------------------------------------- sound
console.log('Sound');
{
  const noErr = [];
  const e = (code, at, message) => noErr.push({ code, at, message });
  const s = compileSound(undefined, e);
  ok(noErr.length === 0 && s.set === 'classic', 'no section means the classic set');
  ok(JSON.stringify(s.moment('pickup')) === JSON.stringify([{ sound: PRESETS.ding }]), 'classic pickup is the ding preset', s.moment('pickup'));
  ok(s.music === null, 'classic has no music');
  for (const [name, set] of Object.entries(SETS)) {
    for (const m of MOMENTS) ok(PRESETS[set[m]], `set ${name} has a preset for ${m}`, set[m]);
    ok(set.music === null || MUSIC[set.music], `set ${name}'s music exists`);
  }
  const arcade = compileSound({ set: 'arcade', moments: { pickup: 'bell', hit: false, tap: { wave: 'square', note: 'C6', ms: 30 } } }, e);
  ok(arcade.moment('pickup')[0].sound.notes?.[0] === 'G5', 'a moment override by preset name', arcade.moment('pickup'));
  ok(arcade.moment('hit').length === 0, 'false silences a moment');
  ok(arcade.moment('tap')[0].sound.note === 'C6', 'a moment override as a synth body');
  ok(arcade.moment('win')[0].sound.notes.length === 4, 'the rest come from the set');
  ok(arcade.music?.asset.sound.startsWith('data:audio/wav;base64,UklGR') && arcade.music.presentation.asset === 'music', 'arcade has a rendered music loop', arcade.music?.presentation);
  const quiet = compileSound({ set: 'arcade', volume: 0.5, music: false }, e);
  ok(quiet.music === null, 'music: false turns music off');
  ok(quiet.moment('pickup')[0].sound.volume === PRESETS.coin.volume * 0.5, 'volume scales moments', quiet.moment('pickup'));
  ok(quiet.scale({ sound: { wave: 'sine', note: 'A4' } }).sound.volume === 0.3, 'volume scales sounds with the default volume');
  ok(quiet.scale({ sound: { note: 'A4', volume: '= 0.2 + x' } }).sound.volume === '= (0.2 + x) * 0.5', 'volume scales expression volumes');
  const mute = compileSound({ volume: 0 }, e);
  ok(mute.moment('win').length === 0 && mute.music === null, 'volume 0 is silent');
  ok(compileSound({ music: 'lullaby' }, e).music !== null && compileSound({ music: true, set: 'chime' }, e).music !== null, 'music by name, or true for a default');
  ok(noErr.length === 0, 'no diagnostics for good sections', noErr);
  const errs = [];
  const e2 = (code, at, message) => errs.push({ code, at });
  compileSound({ set: 'loud', moments: { boom: 'ding', pickup: 'kazoo', hit: { note: 'Z9' } }, music: 'disco', volume: 3, colour: 1 }, e2);
  const got = errs.map((x) => `${x.code} ${x.at}`);
  for (const want of ['A_SOUND_SET /sound/set', 'A_SOUND_MOMENT /sound/moments/boom', 'A_SOUND_PRESET /sound/moments/pickup', 'A_SOUND_FIELD /sound/moments/hit', 'A_SOUND_PRESET /sound/music', 'A_SOUND_FIELD /sound/volume', 'A_SOUND_FIELD /sound/colour']) {
    ok(got.includes(want), `reports ${want}`, got);
  }
  const wav = renderMusic(MUSIC.bounce);
  ok(wav === renderMusic(MUSIC.bounce), 'music rendering is deterministic');
  ok(wav.length < 120 * 1024, 'a music loop stays small', `${Math.round(wav.length / 1024)} KB`);
}

// ---------------------------------------------------------------- art and roles
console.log('Art, sprite roles and fallbacks');
const dodge = {
  authoring: 'microgame-authoring/0.1',
  meta: { title: 'Test Dodge', instructions: 'Dodge.', duration_s: 20 },
  uses: [
    { fragment: 'player_drag', params: { axis: 'x' } },
    { fragment: 'lives', params: { count: 3 } },
    { fragment: 'collide', params: { radius: 24.0, grace: 0 } },
    { fragment: 'spawn_wave', params: { every: '600ms' } },
    { fragment: 'score', params: {} },
  ],
  functions: { colliders: { params: {}, returns: 'list<vec2>', body: 'map(spawns, s => vec(s.x, s.y))' } },
  rules: [{ id: 'tick_point', on: { every: '1000ms' }, do: [{ emit: 'point' }] }],
  objectives: { time_limit: '20s', on_timeout: 'win' },
  presentation: { slots: [], feedback: [] },
  look: { id: 'neon', tokens: {} },
};
{
  const plain = expand(clone(dodge), lib);
  ok(plain.diagnostics.length === 0, 'a game with no art expands cleanly', plain.diagnostics);
  ok(plain.game.format === 'microgame/0.2' && plain.game.assets === undefined, 'no assets without art');
  ok(findNodes(plain.game.presentation.root, (n) => n.node === 'image').length === 0, 'without sprites every role falls back to shapes');
  ok(findNodes(plain.game.presentation.root, (n) => n.node === 'circle').length >= 2, 'the avatar and hazards are circles');
  ok(JSON.stringify(plain.game).indexOf('include') < 0 && JSON.stringify(plain.game).indexOf('@art') < 0, 'no include or @art survives expansion');
  const acts = allActions(plain.game);
  ok(acts.some((a) => a.on === 'hit' && a.particles) && acts.some((a) => a.on === 'hit' && a.shake) && acts.some((a) => a.on === 'hit' && a.haptic), 'hits get particles, shake and a haptic by default');
  ok(plain.game.presentation.feedback.some((f) => f.on === 'hit' && f.when === 'collide__fx_on'), 'hit feedback is gated by `when` so resting contact doesn\'t spam', plain.game.presentation.feedback.filter((f) => f.on === 'hit'));
  ok(acts.some((a) => a.on === 'win' && a.sound) && acts.some((a) => a.on === 'win' && a.particles) && acts.some((a) => a.on === 'lose' && a.sound), 'every game gets win and lose stings');
  ok(acts.filter((a) => a.on === 'point' && a.sound).length === 1, 'score plays the pickup moment');

  const withArt = clone(dodge);
  withArt.art = {
    palette: { bg: '#102030', accent: '#FFCC00' },
    font: 'Avenir Next',
    backdrop: { svg: "<svg viewBox='0 0 360 640'><rect width='360' height='640' fill='#123'/></svg>" },
    sprites: {
      avatar: { svg: "<svg viewBox='0 0 40 50'><rect width='40' height='50'/></svg>", color: '#FF8800' },
      rock: { svg: [DOT, DOT.replace('#F80', '#08F')], fps: 4 },
      life: { svg: DOT },
    },
  };
  withArt.uses[3].art = { hazard: 'rock' };
  const r = expand(withArt, lib);
  ok(r.diagnostics.length === 0, 'a game with art expands cleanly', r.diagnostics);
  const assets = r.game.assets || {};
  ok(Object.keys(assets).join(',') === 'backdrop,avatar,rock,life', 'sprites become assets', Object.keys(assets));
  ok(assets.avatar.w === 51 && assets.avatar.h === 64, 'size defaults from the viewBox (longest side 64)', assets.avatar);
  ok(assets.rock.frames === 2 && assets.rock.cols === 2 && assets.rock.fps === 4 && assets.rock.svg.includes('<svg x="64"'), 'a list of SVGs becomes a sprite sheet', { ...assets.rock, svg: undefined });
  const imgs = findNodes(r.game.presentation.root, (n) => n.node === 'image');
  ok(imgs.some((n) => n.asset === 'avatar' && n.anchor === 'center'), 'player_drag draws the avatar sprite');
  ok(imgs.some((n) => n.asset === 'rock'), 'use.art maps spawn_wave\'s hazard role to the rock sprite');
  ok(imgs.some((n) => n.asset === 'life'), 'lives draws life icons');
  ok(r.game.presentation.root.children[0].asset === 'backdrop' && r.game.presentation.root.children[0].w === 360, 'the backdrop sits under everything');
  const av = imgs.find((n) => n.asset === 'avatar');
  ok(av.h === '= 14.0 * 2.8 * 1.255', 'sprite height follows the sprite\'s aspect', av.h);
  ok(findNodes(r.game.presentation.root, (n) => n.node === 'circle' && n.x === '= player.x').length === 0, 'the fallback avatar circle is dropped');
  ok(r.game.presentation.tokens.bg === '#102030' && r.game.presentation.tokens.accent === '#FFCC00' && r.game.presentation.tokens.primary === '#00E5FF', 'the palette fills look tokens');
  ok(findNodes(r.game.presentation.root, (n) => n.node === 'text').every((n) => n.font === 'Avenir Next'), 'art.font goes on every text node');
  ok(allActions(r.game).some((a) => a.on === 'collected_one') === false, 'no pickups, no pickup feedback');

  const over = clone(withArt);
  over.look.tokens = { accent: '#000000' };
  ok(expand(over, lib).game.presentation.tokens.accent === '#000000', 'look.tokens still override the palette');

  const unused = clone(withArt);
  unused.art.sprites.ufo = { svg: DOT };
  const ru = expand(unused, lib);
  ok(codes(ru).join() === 'W_ART_UNUSED' && ru.diagnostics[0].at === '/art/sprites/ufo' && /avatar \(player_drag\)/.test(ru.diagnostics[0].hint), 'warns about a sprite nothing draws, with the roles on offer', ru.diagnostics);
  const ownNode = clone(unused);
  ownNode.presentation.slots.push({ slot: 'overlay', node: { node: 'image', asset: '= if score > 3 then \'ufo\' else \'rock\'', x: 10, y: 10, w: 20, h: 20 } });
  ok(expand(ownNode, lib).diagnostics.length === 0, 'a sprite the game draws itself counts as used');

  const badRole = clone(withArt);
  badRole.uses[3].art = { enemy: 'rock' };
  badRole.uses[0].art = { avatar: 'hero' };
  const rb = expand(badRole, lib);
  ok(codes(rb).includes('A_UNKNOWN_ART_ROLE') && rb.diagnostics.find((d) => d.code === 'A_UNKNOWN_ART_ROLE').at === '/uses/3/art/enemy', 'an unknown role is reported', rb.diagnostics);
  ok(codes(rb).includes('A_ART_MISSING') && rb.diagnostics.find((d) => d.code === 'A_ART_MISSING').at === '/uses/0/art/avatar', 'a missing sprite is reported');

  const off = clone(withArt);
  off.uses[0].art = { avatar: false };
  const ro = expand(off, lib);
  ok(findNodes(ro.game.presentation.root, (n) => n.node === 'image' && n.asset === 'avatar').length === 0 && codes(ro).includes('W_ART_UNUSED'), 'mapping a role to false draws the fallback');

  const unsafe = clone(withArt);
  unsafe.art.sprites.avatar = { svg: "<svg viewBox='0 0 8 8' onload='steal()'><script>x()</script></svg>" };
  unsafe.art.backdrop = { svg: "<svg viewBox='0 0 8 8'><image href='https://example.com/x.png'/></svg>" };
  const rs = expand(unsafe, lib);
  const svgErrs = rs.diagnostics.filter((d) => d.code === 'A_ART_SVG');
  ok(svgErrs.length >= 3 && svgErrs.every((d) => !d.library), 'unsafe SVG is an A_ART_SVG for the model', rs.diagnostics);
  ok(svgErrs.some((d) => d.at === '/art/sprites/avatar/svg') && svgErrs.some((d) => d.at === '/art/backdrop/svg'), 'pointing at the SVG in the manifest');
  ok(!JSON.stringify(rs.game).includes('steal()') && !JSON.stringify(rs.game).includes('example.com'), 'nothing unsafe reaches game.json');

  const fieldErrs = clone(dodge);
  fieldErrs.art = { palette: { teal: '#00FFFF', bg: 'blue' }, font: 'Comic Sans', sprites: { Hero: { svg: DOT }, a: { svg: DOT, colour: '#fff' }, b: { image: 'https://example.com/a.png', w: 8, h: 8 }, c: {} }, extra: 1 };
  const rf = expand(fieldErrs, lib);
  for (const c of ['A_ART_PALETTE', 'A_ART_FONT', 'A_ART_FIELD', 'A_ART_IMAGE']) ok(codes(rf).includes(c), `reports ${c}`, codes(rf));

  const feel = clone(withArt);
  feel.feel = { shake: false, haptics: false };
  feel.sound = { set: 'soft', volume: 0.5, music: false };
  const rfe = expand(feel, lib);
  const fa = allActions(rfe.game);
  ok(rfe.diagnostics.length === 0 && !fa.some((a) => a.shake) && !fa.some((a) => a.haptic) && fa.some((a) => a.particles), 'feel turns shake and haptics off, keeps particles', rfe.diagnostics);
  ok(rfe.game.presentation.music === undefined && !rfe.game.assets.music, 'music: false leaves no music asset');
  ok(fa.filter((a) => a.sound).every((a) => a.sound.volume <= 0.5), 'every sound is at most half volume');
  const music = clone(withArt);
  music.sound = { set: 'cozy' };
  const rm = expand(music, lib);
  ok(rm.game.assets.music?.sound.startsWith('data:audio/wav') && rm.game.presentation.music.asset === 'music', 'cozy adds its music loop');

  const own = clone(dodge);
  own.presentation.feedback = [{ on: 'point', do: [{ sound: { wave: 'sine', note: 'A5' } }] }, { on: 'win', do: [{ moment: 'combo' }] }];
  const rw = expand(own, lib);
  const pointSounds = allActions(rw.game).filter((a) => a.on === 'point' && a.sound);
  ok(pointSounds.length === 1 && pointSounds[0].sound.note === 'A5', 'a game\'s own sound on an event replaces the library moment there', pointSounds);
  const winSounds = allActions(rw.game).filter((a) => a.on === 'win' && a.sound);
  ok(winSounds.length === 1 && winSounds[0].sound.slide === PRESETS.rise.slide, 'and its own win sound replaces the sting', winSounds);
  const typo = clone(dodge);
  typo.presentation.feedback = [{ on: 'point', do: [{ moment: 'yay' }] }];
  ok(expand(typo, lib).diagnostics.some((d) => d.code === 'A_SOUND_MOMENT' && d.at === '/presentation/feedback/0/do/0/moment'), 'an unknown moment in the game is reported where it is');
}

// Pairs: a moment shared by two fragments on one event plays once, and the card role.
{
  const pairs = {
    authoring: 'microgame-authoring/0.1',
    meta: { title: 'Pairs', instructions: 'Match.', duration_s: 60 },
    uses: [
      { fragment: 'grid_board', params: { cols: 2, rows: 2 } },
      { fragment: 'match_pairs', params: { pairs: 2, cols: 2 } },
      { fragment: 'score', bind: { point: 'pair_found' } },
    ],
    functions: {
      cell_fill: { params: { c: 'ivec2' }, returns: 'string', body: "''" },
      cell_label: { params: { c: 'ivec2' }, returns: 'string', body: "''" },
    },
    objectives: { time_limit: '60s', on_timeout: 'lose' },
    look: { id: 'paper' },
  };
  const plain = expand(clone(pairs), lib);
  ok(plain.diagnostics.length === 0, 'pairs without art expand cleanly', plain.diagnostics);
  ok(allActions(plain.game).filter((a) => a.on === 'pair_found' && a.sound).length === 1, 'pickup on pair_found plays once though two fragments ask for it');
  ok(findNodes(plain.game.presentation.root, (n) => n.node === 'image').length === 0, 'no card overlay without a card sprite');
  const art = clone(pairs);
  art.art = { sprites: { card: { svg: [DOT, DOT] }, cell: { svg: DOT } } };
  const r = expand(art, lib);
  ok(r.diagnostics.length === 0, 'pairs with card and cell sprites expand cleanly', r.diagnostics);
  const imgs = findNodes(r.game.presentation.root, (n) => n.node === 'image');
  ok(imgs.some((n) => n.asset === 'card' && n.frame === '= cards[i].symbol'), 'match_pairs draws card faces by symbol frame');
  ok(imgs.some((n) => n.asset === 'cell'), 'grid_board draws the cell sprite');
  const pf = allActions(r.game).filter((a) => a.on === 'pair_found' && a.particles);
  ok(pf.length === 2 && pf.every((a) => a.particles.color === '$accent'), 'particles fall back to the role\'s token color without a sprite color', pf);
}

// ---------------------------------------------------------------- engine validation (optional)
try {
  const { loadEngine } = await import('./engine.mjs');
  const { engine } = await loadEngine();
  console.log('Engine validation');
  const game = (m) => expand(m, lib).game;
  const withArt = clone(dodge);
  withArt.art = { sprites: { avatar: { svg: DOT }, hazard: { svg: [DOT, DOT], fps: 3 }, life: { svg: DOT } }, backdrop: { svg: DOT } };
  withArt.sound = { set: 'retro' };
  for (const [name, m] of Object.entries({ 'no art': dodge, 'art and sound': withArt })) {
    const d = engine.validate(JSON.stringify(game(clone(m))));
    ok(d.length === 0, `the ${name} test game validates in the engine`, d);
  }
} catch (e) {
  console.log(`(engine checks skipped: ${e.message.split('\n')[0]})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
