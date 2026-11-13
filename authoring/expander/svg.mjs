// SVG safety for Muse-made art (authoring/SPEC.md 2.8). Pure JS with no imports, so the app can
// bundle it with the expander.
//
// sanitizeSvg(text, {maxBytes}) checks one inline SVG against an allowlist and returns
// {ok, svg, errors, viewBox}. It never rewrites what the model drew: on success `svg` is the input
// (trimmed, with an xmlns added if it was missing). On failure `errors` lists short, fixable reasons
// ("<script> isn't allowed", "href must point inside the SVG (#id)").
//
// composeSheet(frames, w, h) lays several sanitized SVGs out left to right as one sprite sheet, with
// each frame's ids prefixed so gradients and filters can't collide.

export const SVG_LIMITS = {
  sprite_bytes: 24 * 1024,
  backdrop_bytes: 64 * 1024,
  art_bytes: 192 * 1024,
  elements: 2000,
  depth: 32,
  image_bytes: 512 * 1024,
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Shapes, text, paint servers, clipping, masking and filters. No script, foreignObject, a, iframe,
// SMIL animation (use sprite-sheet frames instead), or font loading.
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'metadata', 'symbol', 'use', 'switch', 'style',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker', 'image',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA',
  'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode',
  'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
  'feTurbulence',
]);
const WHY_NOT = {
  script: "scripts aren't allowed",
  foreignObject: "<foreignObject> isn't allowed; draw with shapes and text",
  animate: 'SMIL animation isn\'t allowed; animate with sprite frames ("svg": [frame, frame, ...])',
  animateTransform: 'SMIL animation isn\'t allowed; animate with sprite frames',
  animateMotion: 'SMIL animation isn\'t allowed; animate with sprite frames',
  set: 'SMIL animation isn\'t allowed; animate with sprite frames',
  a: "links aren't allowed",
  iframe: "<iframe> isn't allowed", embed: "<embed> isn't allowed", object: "<object> isn't allowed",
  audio: "media elements aren't allowed", video: "media elements aren't allowed",
  'font-face': "web fonts aren't allowed; use art.font",
};
const NAMED_ATTRS = new Set(['xlink:href', 'xml:space', 'xml:lang', 'xmlns:xlink']);
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;

export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s, errors) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    if (ENTITY[body] !== undefined) return ENTITY[body];
    errors?.add(`unknown entity &${body}; (only &amp; &lt; &gt; &quot; &apos; and numeric ones)`);
    return '';
  });
}

// CSS in a style attribute or a <style> element: no imports, no outside urls, no script hooks.
function checkCss(css, errors) {
  const flat = css.replace(/\\/g, '').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
  if (flat.includes('@import')) errors.add("CSS @import isn't allowed");
  if (/@font-face/.test(flat)) errors.add("web fonts aren't allowed; use art.font");
  if (/expression\s*\(|-moz-binding|behavior\s*:/.test(flat)) errors.add("CSS expressions and bindings aren't allowed");
  if (/javascript:|vbscript:/.test(flat.replace(/\s/g, ''))) errors.add("javascript: URLs aren't allowed");
  checkUrls(flat, errors);
}

function checkUrls(value, errors) {
  const re = /url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
  let m;
  while ((m = re.exec(value))) if (!m[2].trim().startsWith('#')) errors.add(`url(${m[2].trim().slice(0, 40)}) points outside the SVG; only url(#id) is allowed`);
  // An unterminated url( is still an outside reference as far as we can tell.
  if (/url\s*\(/i.test(value.replace(re, ''))) errors.add('a url( reference is malformed; use url(#id)');
}

function parseViewBox(attrs) {
  const vb = attrs.viewBox ?? attrs.viewbox;
  if (vb !== undefined) {
    const n = vb.trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0) return { x: n[0], y: n[1], w: n[2], h: n[3], raw: vb.trim() };
    return null;
  }
  const w = parseFloat(attrs.width), h = parseFloat(attrs.height);
  if (w > 0 && h > 0 && /^\s*[0-9.]+(px)?\s*$/.test(attrs.width) && /^\s*[0-9.]+(px)?\s*$/.test(attrs.height)) return { x: 0, y: 0, w, h, raw: `0 0 ${w} ${h}` };
  return null;
}

const ATTR = /\s*([A-Za-z_:][-A-Za-z0-9_:.]*)(\s*=\s*("([^"]*)"|'([^']*)'))?/y;

/**
 * Checks one SVG document. opts: {maxBytes, what} (what names it in messages).
 * Returns {ok, svg, errors: string[], viewBox: {x,y,w,h,raw} | null, rootOpen, rootInner}.
 */
export function sanitizeSvg(input, opts = {}) {
  const maxBytes = opts.maxBytes ?? SVG_LIMITS.sprite_bytes;
  const errors = new Set();
  const fail = () => ({ ok: false, svg: null, errors: [...errors], viewBox: null });
  if (typeof input !== 'string') { errors.add('svg must be a string of SVG markup'); return fail(); }
  const src = input.trim();
  const bytes = utf8Length(src);
  if (bytes > maxBytes) { errors.add(`is ${Math.ceil(bytes / 1024)} KB; the limit is ${Math.floor(maxBytes / 1024)} KB. Use fewer, simpler paths`); return fail(); }
  if (!src.startsWith('<svg')) { errors.add('must start with <svg (no XML declaration, doctype or comment before it)'); return fail(); }

  const stack = [];
  let pos = 0, elements = 0, rootAttrs = null, rootOpenEnd = -1, rootCloseStart = -1, closedRoot = false;
  const ids = [];
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    const text = src.slice(pos, lt < 0 ? src.length : lt);
    if (text.trim()) {
      if (closedRoot) errors.add('has content after </svg>');
      decodeEntities(text, errors);
      if (stack[stack.length - 1] === 'style') checkCss(decodeEntities(text), errors);
    }
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) { errors.add('has an unclosed comment'); break; }
      pos = end + 3; continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (end < 0) { errors.add('has an unclosed CDATA section'); break; }
      if (stack[stack.length - 1] === 'style') checkCss(src.slice(lt + 9, end), errors);
      pos = end + 3; continue;
    }
    if (src.startsWith('<!', lt)) { errors.add("<!DOCTYPE> and <!ENTITY> aren't allowed"); break; }
    if (src.startsWith('<?', lt)) { errors.add("processing instructions (<?...?>) aren't allowed"); break; }
    if (src[lt + 1] === '/') {
      const m = /^<\/([A-Za-z][-A-Za-z0-9_:.]*)\s*>/.exec(src.slice(lt, lt + 80));
      if (!m) { errors.add('has a malformed closing tag'); break; }
      const open = stack.pop();
      if (open !== m[1]) { errors.add(`closes <${m[1]}> but <${open ?? 'nothing'}> is open`); break; }
      if (!stack.length) { closedRoot = true; rootCloseStart = lt; }
      pos = lt + m[0].length; continue;
    }
    // Opening tag.
    const nm = /^<([A-Za-z][-A-Za-z0-9_:.]*)/.exec(src.slice(lt, lt + 80));
    if (!nm) { errors.add(`has a stray '<' at character ${lt}`); break; }
    const name = nm[1];
    if (closedRoot) { errors.add('has content after </svg>'); break; }
    if (!ELEMENTS.has(name)) errors.add(WHY_NOT[name] ?? WHY_NOT[name.toLowerCase()] ?? `<${name}> isn't allowed`);
    elements++;
    let p = lt + nm[0].length;
    const attrs = {};
    for (;;) {
      ATTR.lastIndex = p;
      const am = ATTR.exec(src);
      if (!am || am.index !== p || am[0].trim() === '') break;
      const an = am[1];
      if (am[2] === undefined) { errors.add(`<${name}> attribute ${an} has no value`); }
      const raw = am[4] ?? am[5] ?? '';
      const value = decodeEntities(raw, errors);
      attrs[an] = value;
      p = ATTR.lastIndex;
      const lower = an.toLowerCase();
      const squashed = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (lower.startsWith('on')) errors.add(`event handler attributes (${an}) aren't allowed`);
      else if (an.includes(':') && !NAMED_ATTRS.has(an)) errors.add(`attribute ${an} isn't allowed`);
      else if (lower === 'xmlns' && value !== SVG_NS) errors.add(`xmlns must be ${SVG_NS}`);
      else if (an === 'xmlns:xlink' && value !== XLINK_NS) errors.add(`xmlns:xlink must be ${XLINK_NS}`);
      if (lower === 'href' || an === 'xlink:href') {
        const v = value.trim();
        if (name === 'image' || name === 'feImage') {
          if (!DATA_IMAGE.test(v) && !v.startsWith('#')) errors.add(`<${name}> may only embed a data:image/png, jpeg, gif or webp; outside URLs aren't allowed`);
        } else if (!v.startsWith('#')) errors.add(`${an} must point inside the SVG (#id), not '${v.slice(0, 40)}'`);
      }
      if (/javascript:|vbscript:|data:text/.test(squashed)) errors.add(`${an} has a script URL`);
      if (/url\s*\(/i.test(value)) checkUrls(value, errors);
      if (lower === 'style') checkCss(value, errors);
      if (lower === 'id') ids.push(value);
    }
    const rest = /^\s*(\/?)>/.exec(src.slice(p, p + 64));
    if (!rest) { errors.add(`<${name}> has a malformed attribute or tag end`); break; }
    const selfClose = rest[1] === '/';
    if (!stack.length && !rootAttrs) {
      if (name !== 'svg') errors.add('the root element must be <svg>');
      rootAttrs = attrs; rootOpenEnd = p + rest[0].length;
    } else if (!stack.length) { errors.add('has more than one root element'); break; }
    if (!selfClose) stack.push(name);
    if (stack.length > SVG_LIMITS.depth) { errors.add(`nests deeper than ${SVG_LIMITS.depth} levels`); break; }
    if (selfClose && !stack.length) { closedRoot = true; rootCloseStart = lt; }
    pos = p + rest[0].length;
  }
  if (!errors.size && stack.length) errors.add(`never closes <${stack[stack.length - 1]}>`);
  if (elements > SVG_LIMITS.elements) errors.add(`has ${elements} elements; the limit is ${SVG_LIMITS.elements}`);
  const viewBox = rootAttrs ? parseViewBox(rootAttrs) : null;
  if (rootAttrs && !viewBox) errors.add('needs a viewBox ("0 0 64 64") so it can be scaled');
  if (errors.size) return fail();
  let svg = src;
  if (rootAttrs.xmlns === undefined) svg = svg.replace(/^<svg/, `<svg xmlns="${SVG_NS}"`);
  const needsXlink = /xlink:href/.test(svg) && rootAttrs['xmlns:xlink'] === undefined;
  if (needsXlink) svg = svg.replace(/^<svg/, `<svg xmlns:xlink="${XLINK_NS}"`);
  const shift = svg.length - src.length;
  return {
    ok: true, svg, errors: [], viewBox, ids,
    rootAttrs,
    inner: rootCloseStart > rootOpenEnd ? svg.slice(rootOpenEnd + shift, rootCloseStart + shift) : '',
  };
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Prefixes every id in a frame, and every reference to one, so frames in one sheet can't collide.
function prefixIds(inner, ids, prefix) {
  if (!ids.length) return inner;
  const set = new Set(ids);
  const swap = (id) => (set.has(id) ? prefix + id : id);
  return inner
    .replace(/(\sid\s*=\s*)(["'])([^"']*)\2/g, (m, a, q, id) => `${a}${q}${swap(id)}${q}`)
    .replace(/((?:xlink:)?href\s*=\s*)(["'])#([^"']*)\2/g, (m, a, q, id) => `${a}${q}#${swap(id)}${q}`)
    .replace(/url\(\s*(['"]?)#([^)'"]+)\1\s*\)/g, (m, q, id) => `url(${q}#${swap(id.trim())}${q})`);
}

/**
 * Joins sanitized frames (results of sanitizeSvg) into one sprite-sheet SVG, `cols` frames per
 * row (default: all in one row). Each frame keeps its own viewBox and is drawn into a w × h cell.
 */
export function composeSheet(frames, w, h, cols = frames.length) {
  const rows = Math.ceil(frames.length / cols);
  const W = w * cols, H = h * rows;
  const parts = frames.map((f, i) => {
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    const par = f.rootAttrs.preserveAspectRatio ? ` preserveAspectRatio="${escAttr(f.rootAttrs.preserveAspectRatio)}"` : '';
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${escAttr(f.viewBox.raw)}"${par}>${prefixIds(f.inner, f.ids, `f${i}_`)}</svg>`;
  });
  return `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}
