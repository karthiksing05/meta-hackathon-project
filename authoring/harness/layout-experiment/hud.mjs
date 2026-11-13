// Presentation pass for the gallery experiment. Apply after expansion so the
// existing HUD fragments keep their expressions, events, and state bindings.
const hex = /^#[\da-f]{6}$/i;
const luminance = color => {
  const values = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};
const contrast = (a, b) => {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
};

export function hudOptions(game, authoring) {
  const { w, h } = game.presentation.canvas;
  const bar = y => [{ x: 12, y: y - 24, w: w - 24, h: 48 }];
  const top = { regions: bar(52), description: 'single bar in the upper margin' };
  const splitAt = w - 84;
  const split = { regions: [{x:12,y:28,w:splitAt-20,h:48},
    {x:splitAt,y:28,w:w-splitAt-12,h:48}],
  description: 'score and lives (or score and pairs) at upper left, timer at upper right' };
  const bottom = { regions: bar(h - 40), description: 'single bar in the lower margin' };
  const blockedBottom = authoring.uses.some(({ fragment, params = {} }) =>
    (fragment === 'player_drag' && (params.axis !== 'x' || (params.start_y ?? h - 80) >= h - 125)) ||
    (fragment === 'grid_board' && (params.y ?? 0) + (params.rows ?? 0) *
      ((params.cell_size ?? 0) + (params.gap ?? 0)) >= h - 80));
  const hasBottomControls = game.presentation.root.children.some(n =>
    n.node === 'stack' && n.y > h / 2 && n.children?.length);
  return { top, ...(w >= 340 ? { split } : {}), ...(!blockedBottom && !hasBottomControls ? { bottom } : {}) };
}

function checkedColors(choice, tokens, fixed) {
  const panel = [choice?.panel, tokens.surface, tokens.bg].find(c => hex.test(c ?? '')) ?? '#202029';
  const pick = (values) => values.find(c => hex.test(c ?? '') && contrast(panel, c) >= 4.5);
  const ink = pick([choice?.ink, tokens.ink, '#FFF7E8', '#17151B', '#FFFFFF', '#000000']);
  const warn = pick([choice?.warning, tokens.danger, '#FFD085', '#972520', ink]);
  return { panel, ink, warn, radius: fixed ? 10 : Math.round(Math.max(0, Math.min(18,
    Number.isFinite(choice?.radius) ? choice.radius : 10))) };
}

const rect = ({ x, y, w, h }, colors) =>
  ({ node: 'rect', x, y, w, h, radius: colors.radius, fill: colors.panel });
const center = (region) => [region.x + region.w / 2, region.y + region.h / 2];
const shortHint = (text, title) => {
  const words = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return words(text) === words(title);
};

export function applyHud(manifest, choice, { fixed = false, guide = false, calm = false } = {}) {
  const game = JSON.parse(manifest.content.game_json);
  const authoring = JSON.parse(manifest.content.authoring_json);
  const { root, canvas, tokens } = game.presentation;
  const options = hudOptions(game, authoring);
  const selected = typeof choice?.layout === 'string' ? choice.layout : Object.keys(options)
    .find(key => options[key].description === choice?.layout?.description);
  const layout = !fixed && Object.hasOwn(options, selected) ? selected : 'top';
  const original = root.children.find(n => n.node === 'stack' && n.y < canvas.h / 2 && n.children?.length);
  if (!original) throw Error('The draft has no standard counter row');
  const regions = options[layout].regions;
  if (fixed) regions[0].y = original.y - regions[0].h / 2;
  const colors = checkedColors(choice, tokens, fixed);
  tokens.hud_panel = colors.panel;
  tokens.hud_ink = colors.ink;
  tokens.hud_warning = colors.warn;
  // Color overrides are local to the HUD. Gameplay cues still use the game's original tokens.
  const styleCounter = node => {
    if (node.node === 'text') {
      const color = node.color ?? '$ink';
      if (color.startsWith('=')) {
        node.color = color.replaceAll('$ink', '$hud_ink').replaceAll('$danger', '$hud_warning');
      } else node.color = colors.ink;
      node.size = Math.min(node.size ?? 16, 16);
      for (const [event, animation] of Object.entries(node.animate_on ?? {})) {
        if (animation.prop === 'scale') delete node.animate_on[event];
      }
    }
    for (const child of node.children ?? []) styleCounter(child);
  };
  original.children.forEach(styleCounter);
  root.children.splice(root.children.indexOf(original), 1);
  const children = [];
  const groups = layout === 'split'
    ? [original.children.slice(0, -1), original.children.slice(-1)] : [original.children];
  for (const [i, region] of regions.entries()) {
    const [x, y] = center(region);
    children.push(rect(region, guide ? {panel:'#D84882',radius:3} : colors));
    children.push({ ...original, x, y, gap: fixed ? original.gap : 14, children: groups[i] });
  }

  const staticLabels = new Set((authoring.presentation?.slots ?? [])
    .filter(({ slot, node }) => slot === 'playfield' && node.node === 'text' &&
      typeof node.text === 'string' && !node.text.startsWith('=') && !node.on_tap &&
      !node.on_press && !node.on_drag && typeof node.y === 'number' && node.y < canvas.h / 4)
    .map(({ node }) => node.text));
  const field = root.children.find(n => n.node === 'group' && n.children?.length);
  const hints = [];
  if (field) field.children = field.children.filter(n => {
    if (n.node !== 'text' || !staticLabels.has(n.text)) return true;
    if (fixed || !shortHint(n.text, game.meta.title)) hints.push(n);
    return false;
  });
  // A static instruction repeats the intro rule. Keep it only during the opening
  // seconds of the adaptive variant when Muse requests it.
  if (fixed || choice?.hint === 'brief') {
    for (const [i, hint] of hints.entries()) {
      const size = fixed ? hint.size : 14;
      const w = Math.min(canvas.w - 24, Math.max(150, Math.ceil(hint.text.length * size * 0.68) + 24));
      const y = fixed ? hint.y : layout === 'bottom' ? 32 : 94 + i * 34;
      const h = Math.max(30,Math.ceil(size * 1.25) + 8);
      const region = {x:(canvas.w-w)/2,y:y-h/2,w,h};
      const panel = rect(region, guide ?
        {panel:'#D84882',radius:3} : colors);
      regions.push(region);
      const visible = fixed ? {} : { visible: '= now < 3000' };
      children.push({ node:'group', ...visible, children:[panel,
        {...hint,x:canvas.w/2,y,anchor:'center',size,color:colors.ink,opacity:1}] });
    }
  }
  if (calm) {
    // Tone down the existing illustration locally. Keep this below every
    // gameplay object and let the solid HUD panels handle the text contrast.
    const top = Math.max(0, Math.min(...regions.map(r => r.y)) - 8);
    const bottom = Math.min(canvas.h, Math.max(...regions.map(r => r.y+r.h)) + 8);
    const backdrop = root.children.findIndex(node => node.node === 'image' && node.asset === 'backdrop');
    const washes = [{node:'rect',x:0,y:top,w:canvas.w,h:bottom-top,fill:colors.panel,opacity:0.28}];
    for (let step=0; step<6; step++) {
      const h = 3, opacity = 0.28 * (6-step)/7;
      for (const y of [top-(step+1)*h,bottom+step*h]) {
        if (y>=0 && y+h<=canvas.h) washes.push({node:'rect',x:0,y,w:canvas.w,h,fill:colors.panel,opacity});
      }
    }
    root.children.splice(backdrop+1,0,...washes);
  }
  root.children.push({ node:'group', children });
  const changed = { ...manifest, content:{...manifest.content, game_json:JSON.stringify(game)} };
  return {manifest:changed, regions, layout, colors,
    contrast:{text:contrast(colors.panel,colors.ink), warning:contrast(colors.panel,colors.warn)}};
}
