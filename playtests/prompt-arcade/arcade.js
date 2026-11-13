import {leia, brainrot, myth, cars, geography, jeopardy, lego} from './tabletop.js';
import {runner, crossing, cats} from './action.js';

const games = [
  ['leia','Escape the Death Star','Branching adventure','✦','#874757','Play as Princess Leia. Choose your route, secure the plans, and reach a ship.',leia],
  ['brainrot','Mr. Beast’s Brainrot Quiz','Meme trivia','🎙️','#7e3e83','Pick the correct answer in six rounds of Italian brainrot trivia.',brainrot],
  ['runner','Sahur Subway Sprint','Three-lane runner','🚇','#7d4d31','Swipe, use the arrows, or tap the controls to dodge barriers and escape Cappuccino Assassino.',runner],
  ['myth','Dive into Tartarus','Rarity trivia','🔱','#2f617f','Name a valid answer within 20 seconds. Uncommon answers earn more depth.',myth],
  ['crossing','Spin Cat Crossing','Traffic dodger','🐈','#406749','Hop between lanes of traffic and reach the far sidewalk without getting hit.',crossing],
  ['cars','Garage Bracket','Brand rating','🏁','#765439','Choose which car brand you prefer in each matchup to crown your winner.',cars],
  ['geography','Map Pin Challenge','Geography trivia','🌍','#28645b','Identify the location marked on each map.',geography],
  ['jeopardy','Clue Board','Category trivia','▦','#364d9b','Pick a category and value. Correct responses add points and misses subtract them.',jeopardy],
  ['cats','Cardboard Catapult','Physics puzzle','📦','#8c533e','Pull the cat back and release. Knock the cardboard boxes off the platform in five shots.',cats],
  ['lego','Bedroom Brickfield','Minesweeper','🧱','#5c466f','Clear the dark bedroom floor. Numbers count nearby LEGO bricks. Switch to Flag mode to mark hazards.',lego],
];

const find = id => document.getElementById(id);
const stage = find('stage');
const muse = await fetch('./muse/results.json').then(response => response.json()).catch(() => ({}));
let dispose;
let version = 'updated';
find('count').textContent = games.length + ' games';
for (const [id,title,genre,icon,tint] of games) {
  const link = document.createElement('a');
  link.href = '#' + id;
  link.className = 'card';
  link.style.setProperty('--tint', tint);
  for (const [tag,label] of [['span',icon],['strong',title],['small',genre]]) {
    const item = document.createElement(tag);
    item.textContent = label;
    if (tag === 'span') item.className = 'icon';
    link.append(item);
  }
  find('games').append(link);
}

function load(scroll = true) {
  dispose?.();
  dispose = undefined;
  stage.replaceChildren();
  const index = games.findIndex(game => '#' + game[0] === location.hash);
  find('catalog').hidden = index >= 0;
  find('player').hidden = index < 0;
  if (scroll) window.scrollTo(0,0);
  if (index < 0) return;
  const [id,title,,,tint,rules,mount] = games[index];
  const original = muse[id];
  const updated = original?.updated;
  const selected = version === 'updated' && !updated ? 'muse' : version;
  const generated = selected === 'updated' ? updated : original;
  const useMuse = generated && selected !== 'prototype';
  const versions = find('versions');
  versions.replaceChildren();
  if (original) {
    const choices = [['muse',updated ? 'Original Muse build' : 'Muse build'],['prototype','Hand-tuned build']];
    if (updated) choices.unshift(['updated','Updated Muse build']);
    for (const [name,label] of choices) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = label;
      toggle.setAttribute('aria-pressed', String(name === selected));
      toggle.addEventListener('click', () => { version = name; load(false); });
      versions.append(toggle);
    }
    if (useMuse && !generated.passed) {
      const status = document.createElement('span');
      status.className = 'muted';
      status.textContent = 'Automated playtest flagged';
      status.title = generated.summary;
      versions.append(status);
    }
  }
  find('title').textContent = title;
  find('rules').textContent = useMuse ? generated.title + ' · Tap the game to start.' : rules;
  stage.style.setProperty('--tint',tint);
  find('neighbors').replaceChildren(...[-1,1].map(offset => {
    const [id,name] = games[(index + offset + games.length) % games.length];
    const link = document.createElement('a');
    link.href = '#' + id;
    link.textContent = offset < 0 ? '← ' + name : name + ' →';
    return link;
  }));
  stage.classList.toggle('muse-stage', Boolean(useMuse));
  if (useMuse) {
    const frame = document.createElement('iframe');
    frame.title = generated.title;
    frame.src = 'muse-player.html?game=' + encodeURIComponent(id) + (selected === 'updated' ? '&version=updated' : '');
    stage.append(frame);
  } else {
    dispose = mount(stage, () => load(false));
  }
}
window.addEventListener('hashchange', () => load());
find('restart').addEventListener('click', () => load(false));
load();
