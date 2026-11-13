const query = new URLSearchParams(location.search);
const id = query.get('game');
try {
  if (!/^(leia|brainrot|runner|myth|crossing|cars|geography|jeopardy|cats|lego)$/.test(id)) {
    throw new Error('Choose a game from Prompt Arcade.');
  }
  const suffix = query.get('version') === 'updated' ? '-updated' : '';
  const response = await fetch('muse/' + id + suffix + '.json');
  if (!response.ok) throw new Error('Could not load the Muse build.');
  const manifest = await response.json();
  const validation = Bubble.validate(manifest);
  if (!validation.ok) throw new Error(JSON.stringify(validation.errors));
  const payload = {
    manifest,
    mode: 'play',
    player: {name: 'Tester', best: null},
    muted: true,
    reduced_motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  const prepared = JSON.parse(BubbleHost.prepare(JSON.stringify(payload)));
  if (!prepared.ok) throw new Error(prepared.error);
  const activated = JSON.parse(BubbleHost.activate(prepared.key, JSON.stringify(payload)));
  if (!activated.ok) throw new Error(activated.error);
  document.documentElement.dataset.ready = 'true';
} catch (error) {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'position:absolute;top:24px;left:24px;right:24px;color:#151725;font:16px system-ui';
  message.textContent = error.message;
  document.body.append(message);
}
