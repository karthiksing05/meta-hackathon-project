// Gold v2: Duolingo: Unhinged Owl Streak Sprint (Prod key s5, 97915d706f0339c134ed3786). Unseeded, so
// the loop is rebuilt as well as the look.
//
// The Prod loop asked for typed English on a 30-key on-screen keyboard (31-point keys, a 20 s answer
// clock, a win at a streak of 20): the five gate bots never scored, and a person spends most of a run
// hunting letters. The new loop is Duolingo's own tap-the-translation card:
//   - a Spanish card, four English answers (one right, three near misses), tap one;
//   - a card clock that shrinks as the streak grows (5.5 s down to 2.4 s) and cards dealt easy, then
//     medium, then hard (the Prod list is ordered by length), so stakes rise;
//   - five hearts (as in Duolingo): a wrong answer or a timeout breaks the streak and costs a heart;
//   - the run ends at 30 right (won) or with no hearts left; score = longest streak (as on Prod, so the
//     Group board still reads "longest streak").
// Duo (four moods: calm, cheering, feral past a streak of 10, sad after a miss), the streak flame and
// the hearts are muse-image-1.0 sprites; the sky backdrop, the white card and button frames, and the
// wordmark come from the same art direction (s5.direction.json).

import { text, frame, wordmark, artAssets } from '../build.mjs';

const CARDS = [
  ['hola', 'hello', 'goodbye', 'thanks', 'good night'],
  ['gracias', 'thank you', 'please', 'sorry', 'you are welcome'],
  ['el gato', 'the cat', 'the dog', 'the cake', 'the hat'],
  ['la casa', 'the house', 'the street', 'the car', 'the bed'],
  ['por favor', 'please', 'for you', 'thank you', 'of course'],
  ['buenos días', 'good morning', 'good night', 'nice day', 'good luck'],
  ['el perro es grande', 'the dog is big', 'the dog is small', 'the cat is big', 'the dog is hungry'],
  ['yo quiero agua', 'I want water', 'I drink milk', 'I want food', 'I have water'],
  ['¿Dónde está el baño?', 'Where is the bathroom?', 'Where is the bank?', 'Who is in the bath?', 'When is the bus?'],
  ['la manzana es roja', 'the apple is red', 'the apple is ripe', 'the window is red', 'the tomato is red'],
  ['mi amigo es feliz', 'my friend is happy', 'my friend is tired', 'my uncle is happy', 'my friend is ugly'],
  ['yo como pan y queso', 'I eat bread and cheese', 'I buy bread and milk', 'I eat ham and cheese', 'I cook pasta and cheese'],
  ['el libro está en la mesa', 'the book is on the table', 'the book is on the bed', 'the pen is on the table', 'the book is under the table'],
  ['nosotros vamos a la escuela', 'we go to school', 'we leave school', 'they go to school', 'we go to the beach'],
  ['ella tiene un perro pequeño', 'she has a small dog', 'she has a big dog', 'he has a small cat', 'she wants a small dog'],
  ['yo necesito ayuda ahora', 'I need help now', 'I need water now', 'I give help now', 'I needed help then'],
  ['el tren llega mañana', 'the train arrives tomorrow', 'the train left this morning', 'the plane arrives tomorrow', 'the train arrives today'],
  ['me gusta mucho el café', 'I really like coffee', 'I really like tea', 'I drink a lot of coffee', 'I do not like coffee'],
  ['la puerta está abierta', 'the door is open', 'the door is closed', 'the window is open', 'the store is open'],
  ['hablamos español aquí', 'we speak Spanish here', 'we study Spanish here', 'they speak English here', 'we speak Spanish there'],
  ['el gato está debajo de la mesa', 'the cat is under the table', 'the cat is on the table', 'the dog is under the table', 'the cat is behind the chair'],
  ['quiero un boleto para Madrid', 'I want a ticket to Madrid', 'I have a ticket to Madrid', 'I want a map of Madrid', 'I lost my ticket to Madrid'],
  ['la lección es muy fácil hoy', 'the lesson is very easy today', 'the lesson is very hard today', 'the lesson was easy yesterday', 'the test is very easy today'],
  ['gracias por tu ayuda, amigo', 'thanks for your help, friend', 'thanks for the food, friend', 'sorry for the delay, friend', 'thanks for your gift, friend'],
];
const q = (xs) => `[${xs.map((x) => `'${x.replace(/'/g, "\\'")}'`).join(', ')}]`;

/** The rules: a timed multiple-choice translation card with hearts and a streak. */
function rules(prod) {
  return {
    format: 'microgame/0.2',
    meta: { title: prod.meta.title, instructions: 'Tap the English for each Spanish card before the clock runs out. Right answers grow your streak and the clock gets faster; a miss breaks the streak and costs one of your 5 hearts. Get 30 right to win.', duration_s: 90 },
    state: {
      order: { type: 'list<int>', init: '[]' },
      qi: { type: 'int', init: '0' },
      opts: { type: 'list<string>', init: '[]' },
      picked: { type: 'int', init: '-1' },
      locked: { type: 'bool', init: 'true' },
      streak: { type: 'int', init: '0' },
      best: { type: 'int', init: '0' },
      hearts: { type: 'int', init: '5' },
      right_count: { type: 'int', init: '0' },
      last_result: { type: 'string', init: "''" },
      card__serial: { type: 'int', init: '0' },
      card__until: { type: 'int', init: '0' },
      pace_ms: { type: 'int', init: '5500' },
      content_prompts: { type: 'list<string>', init: q(CARDS.map((c) => c[0])) },
      content_choices: { type: 'list<string>', init: q(CARDS.flatMap((c) => c.slice(1))) },
      content_answers: { type: 'list<string>', init: q(CARDS.map((c) => c[1])) },
      content_calm: { type: 'list<string>', init: q(['Translate, please. I believe in you. Mostly.', 'A tiny streak? Adorable. Keep going.', 'Spanish in, English out. Calm and correct.']) },
      content_excited: { type: 'list<string>', init: q(['YES! KEEP GOING! The streak is warm!', 'Correct! My feathers are doing cardio!', 'Look at that streak. I am so proud.']) },
      content_feral: { type: 'list<string>', init: q(['MORE. CORRECT. NOW. Politely.', 'The streak must live. Translate for its life!', 'I have not blinked since streak five.']) },
      content_sad: { type: 'list<string>', init: q(['The streak... it was so young.', 'I am not mad. I am just a bird.', 'We do not speak of that answer.']) },
    },
    functions: {
      prompt_text: { params: {}, returns: 'string', body: "get_or(content_prompts, get_or(order, qi, 0), '')" },
      correct_answer: { params: {}, returns: 'string', body: "get_or(content_answers, get_or(order, qi, 0), '')" },
      opt_state: { params: { k: 'int' }, returns: 'string', body: "if not locked then '' else if get_or(opts, k, '') == correct_answer() then 'good' else if k == picked then 'bad' else ''" },
      owl_mood: { params: {}, returns: 'string', body: "if last_result == 'wrong' or last_result == 'time' then 'owl_sad' else if streak >= 10 then 'owl_feral' else if streak >= 3 then 'owl_happy' else 'owl_calm'" },
      owl_line: { params: {}, returns: 'string', body: "if last_result == 'wrong' or last_result == 'time' then get_or(content_sad, qi % 3, '') else if streak >= 10 then get_or(content_feral, qi % 3, '') else if streak >= 3 then get_or(content_excited, qi % 3, '') else get_or(content_calm, qi % 3, '')" },
    },
    events: { card__ask: {}, card__timeout: { serial: 'int' }, card__done: {}, answered_right: {}, answered_wrong: {}, heart_lost: {}, streak_up: { streak: 'int' } },
    inputs: { answer: { payload: { index: 'int' } } },
    rules: [
      // Easy cards first, then medium, then hard; each tier shuffled; after all 24, reshuffle the lot.
      { id: 'card__deal', on: 'start', do: [{ set: 'order', to: 'concat(shuffle(range(8)), map(shuffle(range(8)), i => i + 8), map(shuffle(range(8)), i => i + 16))' }, { emit: 'card__ask' }] },
      {
        id: 'card__ask', on: 'card__ask', do: [
          { if: 'qi >= len(order)', then: [{ set: 'order', to: 'shuffle(order)' }, { set: 'qi', to: '0' }] },
          { let: { c: 'order[qi]' } },
          { set: 'opts', to: 'shuffle(slice(content_choices, c * 4, c * 4 + 4))' },
          { set: 'picked', to: '-1' },
          { set: 'locked', to: 'false' },
          { incr: 'card__serial' },
          { set: 'pace_ms', to: 'max(2400, 5500 - streak * 130)' },
          { set: 'card__until', to: 'now + pace_ms' },
          { after: 'pace_ms', emit: 'card__timeout', with: { serial: 'card__serial' }, id: 'card__t_clock' },
        ],
      },
      {
        id: 'card__pick', on: 'answer', when: 'not locked and event.index >= 0 and event.index < len(opts)', do: [
          { set: 'locked', to: 'true' },
          { set: 'picked', to: 'event.index' },
          {
            if: 'opts[event.index] == correct_answer()',
            then: [{ incr: 'right_count' }, { incr: 'streak' }, { set: 'best', to: 'max(best, streak)' }, { set: 'last_result', to: "'right'" }, { emit: 'answered_right' }, { emit: 'streak_up', with: { streak: 'streak' } }],
            else: [{ set: 'streak', to: '0' }, { set: 'last_result', to: "'wrong'" }, { emit: 'answered_wrong' }],
          },
          { after: '650ms', emit: 'card__done', id: 'card__t_reveal' },
        ],
      },
      { id: 'card__run_out', on: 'card__timeout', when: 'not locked and event.serial == card__serial', do: [{ set: 'locked', to: 'true' }, { set: 'streak', to: '0' }, { set: 'last_result', to: "'time'" }, { emit: 'answered_wrong' }, { after: '650ms', emit: 'card__done', id: 'card__t_reveal' }] },
      { id: 'hearts__lose', on: 'answered_wrong', when: 'hearts > 0', do: [{ decr: 'hearts' }, { emit: 'heart_lost' }] },
      { id: 'card__next', on: 'card__done', when: 'hearts > 0 and right_count < 30', do: [{ incr: 'qi' }, { emit: 'card__ask' }] },
    ],
    objectives: { win: 'right_count >= 30', lose: 'hearts <= 0', score: 'best', time_limit: '150s', on_timeout: 'lose' },
  };
}

export function build(prod, art) {
  const g = rules(prod);
  const T = (step, value, props) => text(art, step, value, props);
  const by = (k, dy = 0) => `= 456 + ${k} * 57${dy ? ` + ${dy}` : ''}`;

  // HUD band (y 112–168): one white plaque with hearts, the streak flame and the best streak.
  const hud = {
    node: 'group', children: [
      frame(art, 'banner', 14, 112, 332, 56),
      { node: 'repeat', source: 'range(5)', as: 'k', key: 'k', template: { node: 'image', asset: 'heart', x: '= 26 + k * 25', y: 128, w: 24, h: 23, opacity: '= if k < hearts then 1.0 else 0.2', transition: { opacity: { ms: 250, ease: 'out' } }, animate_on: { heart_lost: { when: 'k == hearts', prop: 'scale', keys: [1, 1.12, 1], ms: 240 } } } },
      { node: 'image', asset: 'flame', x: 162, y: 120, w: 32, h: 40, opacity: '= if streak > 0 then 1.0 else 0.35', transition: { opacity: { ms: 200, ease: 'out' } }, animate_on: { streak_up: { prop: 'scale', keys: [1, 1.12, 1], ms: 220, ease: 'out' } } },
      T('title', '= str(streak)', { numerals: true, x: 198, y: 118, w: 46, h: 44, align: 'left', valign: 'middle', color: '$ink' }),
      T('label', "= 'Best ' + str(best)", { x: 248, y: 118, w: 88, h: 44, align: 'center', valign: 'middle', color: '$ink' }),
    ],
  };

  // Duo and his line.
  const owl = { node: 'image', asset: '= owl_mood()', x: 16, y: 176, w: 136, h: 136, animate_on: { answered_right: { prop: 'y', keys: [176, 164, 176], ms: 320, ease: 'out' } } };
  const bubble = frame(art, 'panel', 156, 186, 188, 112);
  const line = T('body', '= owl_line()', { x: 168, y: 194, w: 164, h: 96, wrap: true, align: 'center', valign: 'middle', color: '$ink' });

  // The card: the Spanish prompt, and its clock.
  const card = frame(art, 'panel', 20, 318, 320, 112);
  const cardCap = T('caption', 'Translate this', { x: 36, y: 326, w: 288, h: 22, align: 'center', valign: 'middle', color: '$ink_muted' });
  const prompt = T('title', '= prompt_text()', { x: 36, y: 348, w: 288, h: 70, wrap: true, align: 'center', valign: 'middle', color: '$ink' });
  const clock = { node: 'rect', x: 30, y: 437, h: 8, radius: 4, w: '= if locked then 0.0 else max(0.0, 300.0 * ((card__until - now) * 1.0) / (pace_ms * 1.0))', fill: '= if card__until - now < 1200 then $danger else $primary' };

  // Four answers: a white button frame, the tap rect (tinted green or red once answered), the words.
  const btn = frame(art, 'button', 24, 0, 312, 52);
  const answers = {
    node: 'repeat', source: 'range(4)', as: 'k', key: 'k',
    template: {
      node: 'group',
      animate_on: { answer: { when: 'event.index == k', prop: 'scale', keys: [1, 0.97, 1], ms: 160 } },
      children: [
        { ...btn, y: by('k') },
        { node: 'rect', x: 28, y: by('k'), w: 304, h: 46, radius: 14, fill: "= if opt_state(k) == 'good' then '#58CC02CC' else if opt_state(k) == 'bad' then '#FF4B4BCC' else '#00000000'", transition: { fill: { ms: 120, ease: 'out' } }, on_tap: { input: 'answer', with: { index: 'k' } } },
        T('body', "= get_or(opts, k, '')", { x: 34, y: by('k'), w: 292, h: 46, size: 17, align: 'center', valign: 'middle', color: '$ink' }),
      ],
    },
  };

  const endCard = {
    node: 'group', visible: "= status != 'playing'",
    animate_on: { win: { prop: 'opacity', keys: [0, 1], ms: 200, ease: 'out' }, lose: { prop: 'opacity', keys: [0, 1], ms: 200, ease: 'out' } },
    children: [
      { node: 'rect', x: -40, y: -40, w: 440, h: 860, fill: '#1CB0F6CC' },
      frame(art, 'panel', 28, 128, 304, 500),
      wordmark(art, 180, 206, 260, 110),
      { node: 'image', asset: "= if status == 'won' then 'owl_happy' else 'owl_sad'", x: 120, y: 268, w: 120, h: 120 },
      T('title', "= if status == 'won' then 'Lesson complete!' else 'Out of hearts'", { x: 44, y: 396, w: 272, h: 36, align: 'center', valign: 'middle', color: '$ink' }),
      T('hero', '= str(best)', { numerals: true, x: 44, y: 436, w: 272, h: 64, align: 'center', valign: 'middle', color: '$primary' }),
      T('label', 'longest streak', { x: 44, y: 500, w: 272, h: 24, align: 'center', valign: 'middle', color: '$ink' }),
      T('body', "= str(right_count) + ' cards right'", { x: 44, y: 534, w: 272, h: 28, align: 'center', valign: 'middle', color: '$ink' }),
    ],
  };

  const playing = { node: 'group', visible: "= status == 'playing'", children: [owl, bubble, line, card, cardCap, prompt, clock, answers] };
  g.presentation = {
    canvas: { w: 360, h: 780, background: '$bg' },
    tokens: { ...art.kit.palette, danger: '#FF4B4B' },
    root: { node: 'group', children: [{ node: 'image', asset: 'backdrop', x: 0, y: 0, w: 360, h: 780 }, playing, hud, endCard] },
    feedback: [
      { on: 'answered_right', do: [{ sound: { wave: 'triangle', notes: ['E6', 'B6'], step_ms: 45, volume: 0.3 } }, { particles: { x: 180, y: '= 482 + max(0, picked) * 57', count: 16, color: '$primary', speed: 220, size: 5, ms: 450 } }, { haptic: 'success' }] },
      { on: 'answered_wrong', do: [{ sound: { wave: 'sawtooth', notes: ['E4', 'D#4'], step_ms: 120, volume: 0.18 } }, { shake: { px: 3, ms: 140 } }, { haptic: 'warning' }] },
      { on: 'win', do: [{ sound: { wave: 'square', notes: ['E5', 'G5', 'E6', 'C6', 'G6'], step_ms: 75, volume: 0.188 } }, { particles: { x: 180, y: 330, count: 36, color: '$primary', speed: 320, size: 7, ms: 1200, gravity: 520 } }, { haptic: 'success' }] },
      { on: 'lose', do: [{ sound: { wave: 'sawtooth', notes: ['E4', 'D#4', 'D4'], step_ms: 160, volume: 0.188 } }, { haptic: 'error' }] },
    ],
    ...(prod.presentation?.music ? { music: prod.presentation.music } : {}),
  };
  const keep = Object.fromEntries(Object.entries(prod.assets ?? {}).filter(([, a]) => a.sound));
  g.assets = { ...keep, ...artAssets(art) };
  return g;
}

/** The manifest fields that describe the loop (score bounds, rule line) for the new rules. */
export function manifestPatch(m) {
  return {
    one_line_rule: 'Tap the English for each Spanish card before the clock runs out.',
    score: { ...m.score, bounds: { min: 0, max: 30, max_rate_per_s: 2.5 }, ranked: m.score?.ranked ?? false },
  };
}
