import fs from 'node:fs';
import path from 'node:path';
const [repo, envPath, out, ...selected] = process.argv.slice(2);
const { compose } = await import(path.join(repo, 'backend/generator/src/composer.mjs'));
const { MuseClient } = await import(path.join(repo, 'backend/generator/src/muse.mjs'));
const { loadStudio } = await import(path.join(repo, 'backend/generator/src/studio.mjs'));
const apiKey = process.env.MUSE_API_KEY || fs.readFileSync(envPath, 'utf8').match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!apiKey) throw Error('Missing Muse key');
const studio = loadStudio(); // the engine and Studio bundles from the app's folders
const games = {
  moth: 'Make me a little game where I slide a lantern along the bottom to catch moths, but avoid falling raindrops. Make it look like a handmade paper shadowbox.',
  lunch: 'Make me a quick game where I slide a lunch tray left and right to catch dumplings and dodge the falling chili peppers.',
  tide: 'Make a memory game where I flip over tide pool tiles to find matching sea creatures before time runs out. Make it feel like a watercolor field notebook.',
};
await Promise.allSettled(Object.entries(games).filter(([id]) =>
  selected.length ? selected.includes(id) : id !== 'tide').map(async ([id, request]) => {
  try {
    const calls = [];
    const file = path.join(out, id + '-draft.json');
    if (fs.existsSync(file)) return;
    const muse = new MuseClient({ apiKey, fetchImpl: async (url, init) => {
      if (calls.length >= 7) return new Response('Experiment request limit', {status: 400});
      const entry = { max_tokens: JSON.parse(init.body).max_tokens };
      calls.push(entry);
      const response = await fetch(url, init);
      entry.status = response.status;
      entry.usage = (await response.clone().json().catch(() => ({}))).usage;
      fs.writeFileSync(path.join(out,id+'-usage.json'), JSON.stringify(calls,null,2));
      return response;
    }});
    const result = await compose({ request, brief: { intent: request } }, {
      muse, studio, onEvent: e => console.log(id, e.summary),
    });
    fs.writeFileSync(file, JSON.stringify({ request, ...result }, null, 2));
  } catch (e) { console.error(id, e.message); process.exitCode = 1; }
}));
