// The compose-prompt section that teaches Muse the UI kit (authoring/UI_KIT.md). The integrator
// pastes `kitPromptSection()` into the compose prompt (prompts.mjs); nothing else imports it yet.
// Generated from the kit's own tables so it never drifts from the code.

import { THEME_NAMES, FAMILIES, DENSITIES, TYPE, TYPE_STEPS } from './ui-style.mjs';
import { COMPONENTS } from './ui-kit.mjs';

export function kitPromptSection() {
  const comps = Object.entries(COMPONENTS).map(([k, v]) => `- ${k} (${v.region}): ${v.describe}`).join('\n');
  return `UI KIT (game-style/1). Every game uses it. You never place UI with coordinates, sizes or colours.

"ui": { "kit": "game-style/1", "theme": "<${THEME_NAMES.join('|')}>", "base": "#RRGGBB", "accent": "#RRGGBB", "family": "<${Object.keys(FAMILIES).join('|')}>", "density": "<${Object.keys(DENSITIES).join('|')}>" }
- base: the subject's main colour. theme: the mood (light: bright soft paper mono retro; dark: night neon dusk).
  The palette, text colours (WCAG AA), type sizes, spacing, corner radii and motion are derived from this.
- Type steps (fixed): ${TYPE_STEPS.map((s) => `${s} ${TYPE[s].size}`).join(', ')}. Text never goes smaller than 13.

Write UI as components: a node with "ui" instead of "node", in a slot. They take content, not x/y:
${comps}
- hud_top: up to 3 "stat" components (score, round, lives and timer fragments already add theirs).
- Text props may be expressions ("= question_text()"); the kit fits text to its box (shrink, wrap, "…").
- Tones: primary, accent, danger, success, secondary, surface. Colours in your own nodes: tokens only
  ($bg $surface $surface_2 $ink $ink_muted $primary $accent $danger $success $line, $on_<role> for text on
  a filled role, $<role>_ink for small text in a role colour). Never a #hex.
- Regions: HUD band y 24–72, then top components, then the playfield, then controls stacked up from
  y 616. Only moving game pieces (actors, pickups, hazards) use x/y, and they stay inside the playfield.
- Tap targets are at least 44 × 44.`;
}
