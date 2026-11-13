// The game supplies geometry and asset roles. The same prompt works across renderers.
export function visualMessages(brief, { structured = true } = {}) {
  const contract = [
    'Art-direct a small portrait game. Return one JSON object mapping the named asset roles to standalone SVG strings.',
    'Use matching viewBoxes starting at 0 0, with the width and height given for each role.',
    'No text, external references, scripts, or animation. Keep each SVG under 6 KB.',
    'The game draws labels, interaction targets and feedback. Coordinate all art as one set.',
    ...brief.assets.map(({ id, width, height, purpose, transparent }) =>
      `${id} (${width}×${height}, ${transparent ? 'transparent' : 'opaque'}): ${purpose}`),
  ];
  if (structured) {
    contract.push(
      'Use the supplied palette. Keep important objects recognizable at the specified play size.',
      'Respect the protected zones. Keep them low contrast and avoid details that look like controls.',
      'Give each sprite a clear silhouette and keep it inside its specified padding.',
      'Use the stated anchor so the sprite aligns with the game. Keep backdrop detail away from feedback.',
      'Palette: ' + JSON.stringify(brief.palette),
      'Protected zones: ' + JSON.stringify(brief.zones),
      'Sprite placement: ' + JSON.stringify(brief.placement),
    );
  }
  return [
    { role: 'system', content: contract.join('\n') },
    { role: 'user', content: brief.request },
  ];
}

// Install a complete art pack without changing the game's layout, input, or rules.
export function applyVisualPack(game, brief, pack, sanitizeSvg) {
  const result = structuredClone(game);
  for (const { id, width, height } of brief.assets) {
    const asset = result.assets?.[id];
    if (!asset) throw Error(`The game does not declare the "${id}" asset role.`);
    const checked = sanitizeSvg(pack[id], { maxBytes: 6144 });
    if (!checked.ok) throw Error(`${id}: ${checked.errors.join(', ')}`);
    const box = checked.viewBox;
    if (box.x !== 0 || box.y !== 0 || box.w !== width || box.h !== height) {
      throw Error(`${id}: expected a 0 0 ${width} ${height} viewBox.`);
    }
    result.assets[id] = { ...asset, svg: checked.svg };
  }
  return result;
}
