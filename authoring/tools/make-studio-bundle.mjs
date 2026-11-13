#!/usr/bin/env node
// Builds the authoring layer for Muse Studio in the iOS app:
//   FacebookClone/Bubbles/Studio/web/microgame-studio.js
//
// One classic (non-module) script that defines `window.MicrogameStudio` (docs/BUBBLES.md 7.12). It
// holds:
//   - the expander, wrap.mjs, the async bot gate and the Studio API (authoring/expander/studio.mjs
//     and everything it imports), each ES module wrapped in its own function scope;
//   - as data: the fragment and look library (so nothing reads disk), the engine's
//     `microgame catalog --json`, the model-facing format rules from SPEC.md, and a few example
//     authoring manifests from games/.
// The page (microgame-studio.html) loads bubble-kit-microgame-engine.js first, for the engine.
//
// Usage: node authoring/tools/make-studio-bundle.mjs [--check] [--catalog catalog.json]
//   --check:    exit 1 if the committed bundle differs from a fresh build.
//   --catalog:  use a saved `catalog --json` instead of running the engine's CLI. Without it the
//               script runs `cargo run --release -q -p mg-cli -- catalog --json` in engine/ (set
//               CARGO_TARGET_DIR to build elsewhere).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { loadLibrary, expand } from '../expander/expand.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
const root = join(authoringDir, '..');
const out = join(root, 'FacebookClone', 'Bubbles', 'Studio', 'web', 'microgame-studio.js');
const entry = join(authoringDir, 'expander', 'studio.mjs');
const args = process.argv.slice(2);
const check = args.includes('--check');
const catalogArg = args.includes('--catalog') ? args[args.indexOf('--catalog') + 1] : null;

// Example manifests shown to Muse: an action game with a playtest hint, a dodge game and a board.
const EXAMPLES = ['tide_taps', 'fog_dodge', 'postcard_pairs'];

// ---------- a tiny ES module bundler (enough for authoring/: named imports and exports) ----------

const IMPORT_RE = /^import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+function\*?|function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}\s*(?:from\s+['"]([^'"]+)['"])?;?[ \t]*$/gm;

function parseBindings(clause, spec) {
  clause = clause.trim();
  if (!clause) return [];
  const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
  if (ns) return [{ ns: ns[1] }];
  const named = /^\{([\s\S]*)\}$/.exec(clause);
  if (!named) throw new Error(`unsupported import "${clause}" from ${spec} (only named and namespace imports)`);
  return named[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, alias] = s.split(/\s+as\s+/);
    return { name: name.trim(), local: (alias ?? name).trim() };
  });
}

function bundle(entryFile) {
  const modules = new Map(); // key -> {key, code, deps}
  const order = [];
  const keyOf = (file) => relative(authoringDir, file).split('\\').join('/');

  function load(file) {
    const key = keyOf(file);
    if (modules.has(key)) return key;
    modules.set(key, null); // cycle guard
    let src = readFileSync(file, 'utf8');
    const prelude = [];
    src = src.replace(IMPORT_RE, (_, clause = '', spec) => {
      let depKey;
      if (spec.startsWith('node:')) depKey = spec;
      else if (spec.startsWith('.')) depKey = load(resolve(dirname(file), spec));
      else throw new Error(`${key}: can't bundle the package import '${spec}'`);
      for (const b of parseBindings(clause, spec)) {
        prelude.push(b.ns ? `const ${b.ns} = __m[${JSON.stringify(depKey)}];` : `const ${b.local} = __m[${JSON.stringify(depKey)}].${b.name};`);
      }
      return '';
    });
    const exported = [];
    src = src.replace(EXPORT_LIST_RE, (_, list, from) => {
      const fromKey = from ? load(resolve(dirname(file), from)) : null;
      for (const s of list.split(',').map((x) => x.trim()).filter(Boolean)) {
        const [name, alias] = s.split(/\s+as\s+/);
        exported.push([(alias ?? name).trim(), fromKey ? `__m[${JSON.stringify(fromKey)}].${name.trim()}` : name.trim()]);
      }
      return '';
    });
    src = src.replace(EXPORT_DECL_RE, (_, kind, name) => { exported.push([name, name]); return `${kind} ${name}`; });
    if (/^\s*(import|export)\b/m.test(src) || /\bimport\.meta\b/.test(src)) throw new Error(`${key}: module syntax the bundler doesn't handle`);
    const exportsObj = exported.map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ');
    modules.set(key, { key, code: `// ---- authoring/${key} ----\n__m[${JSON.stringify(key)}] = (function () {\n"use strict";\n${prelude.join('\n')}\n${src.trim()}\nreturn Object.freeze({ ${exportsObj} });\n})();\n` });
    order.push(key);
    return key;
  }

  const entryKey = load(entryFile);
  return { entryKey, code: order.map((k) => modules.get(k).code).join('\n') };
}

// ---------- data ----------

function engineCatalog() {
  if (catalogArg) return JSON.parse(readFileSync(resolve(catalogArg), 'utf8'));
  const env = { ...process.env, PATH: `${join(homedir(), '.cargo', 'bin')}:/opt/homebrew/opt/rustup/bin:${process.env.PATH}` };
  const text = execFileSync('cargo', ['run', '--release', '-q', '-p', 'mg-cli', '--', 'catalog', '--json'], { cwd: join(root, 'engine'), env, maxBuffer: 64 << 20 }).toString();
  return JSON.parse(text);
}

/** The parts of SPEC.md the model needs: names and bind (1.2), objectives (1.3), slots (1.4) and the manifest (2). */
function formatRules() {
  const md = readFileSync(join(authoringDir, 'SPEC.md'), 'utf8');
  const lines = md.split('\n');
  const take = (startRe, endRe) => {
    const s = lines.findIndex((l) => startRe.test(l));
    if (s < 0) return '';
    let e = lines.findIndex((l, i) => i > s && endRe.test(l));
    if (e < 0) e = lines.length;
    return lines.slice(s, e).join('\n').trim();
  };
  const parts = [
    take(/^### 1\.1\b/, /^#{2,3} /),
    take(/^### 1\.2\b/, /^#{2,3} /),
    take(/^### 1\.3\b/, /^#{2,3} /),
    take(/^### 1\.4\b/, /^#{2,3} /),
    take(/^## 2\b/, /^## (?!2\b)/),
  ].filter(Boolean);
  if (!parts.length) throw new Error('SPEC.md: no sections 1.1–1.4 or 2 found');
  return parts.join('\n\n');
}

function examples(lib) {
  return EXAMPLES.map((name) => {
    const manifest = JSON.parse(readFileSync(join(authoringDir, 'games', `${name}.authoring.json`), 'utf8'));
    const errors = expand(manifest, lib).diagnostics.filter((d) => d.severity === 'error');
    if (errors.length) throw new Error(`example ${name} doesn't expand: ${errors[0].code} ${errors[0].message}`);
    return { name, manifest };
  });
}

// ---------- build ----------

const lib = loadLibrary(authoringDir);
const cat = engineCatalog();
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
// The gold set (authoring/gold/): example games paired with requests; Studio picks the closest
// ones per request (expander/gold.mjs). Each must expand with no errors.
function gold(lib) {
  const index = JSON.parse(readFileSync(join(authoringDir, 'gold', 'index.json'), 'utf8'));
  return index.map((e) => {
    const manifest = JSON.parse(readFileSync(join(authoringDir, e.file.replace(/^authoring\//, '')), 'utf8'));
    const errors = expand(manifest, lib).diagnostics.filter((d) => d.severity === 'error');
    if (errors.length) throw new Error(`gold ${e.id} doesn't expand: ${errors[0].code} ${errors[0].message}`);
    const { file, fragments_used, ...rest } = e;
    return { ...rest, manifest };
  });
}

const data = {
  library: lib,
  engineCatalog: cat,
  formatRules: formatRules(),
  examples: examples(lib),
  gold: gold(lib),
  build: { commit, fragments: Object.keys(lib.fragments).length, looks: Object.keys(lib.looks).length, engine_version: cat.engine_version ?? null },
};
const { entryKey, code } = bundle(entry);
const stubs = [...new Set([...code.matchAll(/__m\["(node:[^"]+)"\]/g)].map((m) => m[1]))].sort();

const text = `/*
 * microgame-studio.js: GENERATED by authoring/tools/make-studio-bundle.mjs. Do not edit.
 * The microgame authoring layer for Muse Studio (docs/BUBBLES.md 7.12): the expander, the Bubble
 * wrapper, the async bot gate and the Studio API, with the fragment library (${data.build.fragments} fragments,
 * ${data.build.looks} looks), the engine catalog (${data.build.engine_version}) and the format rules as data.
 * Loaded by microgame-studio.html after bubble-kit-microgame-engine.js. Defines \`MicrogameStudio\`.
 * Built from authoring/ at ${commit}.
 */
(function (root) {
  "use strict";
  if (root.MicrogameStudio) return;
  const __m = Object.create(null);
  // Node built-ins the modules import but never call in the app (loadLibrary reads disk; the app
  // passes the library in instead).
  const __nodeStub = (name) => new Proxy({}, { get: (_, key) => function () { throw new Error(name + "." + String(key) + " isn't available in the Studio bundle"); } });
${stubs.map((s) => `  __m[${JSON.stringify(s)}] = __nodeStub(${JSON.stringify(s)});`).join('\n')}

${code}
  const DATA = ${JSON.stringify(data)};

  const engineLib = () => (typeof root.MicrogameEngine !== "undefined" ? root.MicrogameEngine : null);
  root.MicrogameStudio = __m[${JSON.stringify(entryKey)}].createStudio(DATA, {
    getEngine: () => { const L = engineLib(); return L ? L.getEngine() : null; },
    engineError: () => { const L = engineLib(); return L ? L.engineError() : "bubble-kit-microgame-engine.js isn't loaded"; },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

if (check) {
  const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
  const norm = (s) => s.replace(/Built from authoring\/ at \S+\./, '').replace(/"commit":"[^"]*"/, '');
  if (norm(cur) !== norm(text)) {
    console.error(`${out} is out of date: run node authoring/tools/make-studio-bundle.mjs`);
    process.exit(1);
  }
  console.log('studio bundle is up to date');
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote ${relative(root, out)}: ${(text.length / 1024).toFixed(0)} KiB (${data.build.fragments} fragments, ${data.build.looks} looks, ${data.examples.length} examples, ${data.gold.length} gold, engine catalog ${data.build.engine_version})`);
}
