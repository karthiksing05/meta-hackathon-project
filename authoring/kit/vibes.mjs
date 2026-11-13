// The vibe table: a game's theme, era, genre and style words → 2–3 type pairings that fit them.
// No house style: each game gets the pairing its own words point to, and the game id picks among
// the vibe's pairings and its scale, so two games with the same vibe still differ.
//
// A vibe:
//   id, words (matched as whole words or prefixes, case-insensitive; a multi-word entry matches the
//   phrase), fallback (the system stack for the vibe's mood, used when a bundled font can't load),
//   pairings.
// A pairing:
//   display    font id (authoring/fonts/fonts.json) for the hero, display and (title: 'display') titles
//   text       font id for body, labels and captions
//   numerals   optional font id for scores, timers and counters (tabular where possible)
//   title      'display' | 'text': which font sets the title step
//   case       { display: 'upper' | 'asis', label: 'upper' | 'asis' }
//   tracking   { display, label } in em: recorded for the renderer (the engine draws no letter
//              spacing yet; see authoring/kit/README.md)
//   weights    { label: 'strong' | 'regular', title: 'strong' | 'regular' }: which of the text
//              font's two weights each step uses (body is always regular)
//   treatment  'none' | 'outline' | 'heavy': an outline under display text (engine text stroke)
//   ratio      [lo, hi] the modular scale ratio range; base [lo, hi] the body size range
//
// Pure JS, no imports (the Studio bundle packs it).

const P = (id, display, text, o = {}) => ({
  id, display, text, numerals: o.numerals ?? null, title: o.title ?? 'display',
  case: { display: o.dcase ?? 'asis', label: o.lcase ?? 'asis' },
  tracking: { display: o.dtrack ?? 0, label: o.ltrack ?? (o.lcase === 'upper' ? 0.06 : 0) },
  weights: { label: o.label ?? 'strong', title: o.tweight ?? 'strong' },
  treatment: o.treatment ?? 'none',
  ratio: o.ratio ?? [1.2, 1.25], base: o.base ?? [16, 17],
});

export const VIBES = [
  {
    id: 'game_show', fallback: ['Futura-CondensedExtraBold', 'Avenir Next Condensed'],
    words: ['game show', 'price is right', 'jeopardy', 'wheel of fortune', 'quiz show', 'host', 'contestant', 'showcase', 'come on down', 'studio audience', 'family feud', 'millionaire', 'buzzer', 'tv show'],
    pairings: [
      P('marquee', 'bowlby', 'archivo', { numerals: 'teko', dcase: 'upper', lcase: 'upper', treatment: 'heavy', ratio: [1.25, 1.3] }),
      P('slab_stage', 'alfa_slab', 'barlow_cond', { numerals: 'teko', lcase: 'upper', treatment: 'outline', base: [16, 17] }),
      P('tv_card', 'dela_gothic', 'rubik', { numerals: 'archivo_black', dcase: 'upper', treatment: 'outline', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'retro_80s', fallback: ['Futura', 'Avenir Next Condensed'],
    words: ['1980s', '80s', 'eighties', '1981', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989', 'synthwave', 'vhs', 'cassette', 'outrun', 'miami', 'mall', 'walkman', 'boombox', 'neon'],
    pairings: [
      P('chrome', 'righteous', 'josefin', { numerals: 'vt323', lcase: 'upper', ltrack: 0.12, treatment: 'outline', ratio: [1.25, 1.3] }),
      P('mall_sign', 'bungee', 'space_grotesk', { numerals: 'teko', treatment: 'heavy' }),
      P('laser', 'audiowide', 'barlow_cond', { numerals: 'share_tech_mono', dcase: 'upper', lcase: 'upper', treatment: 'outline', base: [16, 17] }),
    ],
  },
  {
    id: 'pixel_arcade', fallback: ['Menlo-Bold', 'Menlo'],
    words: ['pixel', '8-bit', '8 bit', '16-bit', 'retro game', 'chiptune', 'arcade', 'galaga', 'space invaders', 'pac-man', 'pacman', 'gameboy', 'nes', 'snes', 'shmup', 'shoot em up', 'retro rpg', 'high score', 'tetris', 'asteroids'],
    pairings: [
      P('cabinet', 'press_start', 'space_mono', { numerals: 'press_start', dcase: 'upper', lcase: 'upper', treatment: 'heavy', ratio: [1.2, 1.25] }),
      P('handheld', 'silkscreen', 'vt323', { lcase: 'upper', treatment: 'outline', base: [17, 17], ratio: [1.2, 1.25] }),
      P('terminal', 'press_start', 'share_tech_mono', { numerals: 'vt323', dcase: 'upper', treatment: 'outline', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'space_saga', fallback: ['Futura', 'Avenir Next'],
    words: ['space', 'star wars', 'death star', 'galaxy', 'galactic', 'sci-fi', 'scifi', 'alien', 'starship', 'rebel', 'empire', 'jedi', 'sith', 'planet', 'rocket', 'astronaut', 'orbit', 'leia', 'stormtrooper', 'cosmic', 'nasa', 'mars'],
    pairings: [
      P('hyperspace', 'orbitron', 'space_grotesk', { numerals: 'share_tech_mono', dcase: 'upper', lcase: 'upper', ltrack: 0.1, treatment: 'none', ratio: [1.2, 1.25] }),
      P('briefing', 'michroma', 'barlow_cond', { numerals: 'teko', dcase: 'upper', lcase: 'upper', base: [16, 17] }),
      P('cockpit', 'audiowide', 'outfit', { numerals: 'share_tech_mono', title: 'text', treatment: 'outline' }),
    ],
  },
  {
    id: 'cyber_tech', fallback: ['Menlo', 'Avenir Next Condensed'],
    words: ['cyber', 'cyberpunk', 'hacker', 'hack', 'glitch', 'matrix', 'robot', 'ai', 'chip', 'gpu', 'nvidia', 'jensen', 'silicon', 'startup', 'code', 'tech', 'computer', 'spy', 'spies', 'honeypot', 'virus', 'data'],
    pairings: [
      P('neon_grid', 'syne', 'share_tech_mono', { numerals: 'share_tech_mono', title: 'text', dcase: 'upper', ratio: [1.2, 1.25] }),
      P('readout', 'orbitron', 'space_mono', { numerals: 'space_mono', lcase: 'upper', base: [15, 16] }),
      P('keynote', 'space_grotesk', 'dm_sans', { numerals: 'share_tech_mono', ratio: [1.25, 1.333] }),
    ],
  },
  {
    id: 'meme_brainrot', fallback: ['ArialRoundedMTBold', 'Chalkboard SE'],
    words: ['brainrot', 'brain rot', 'meme', 'skibidi', 'rizz', 'sigma', 'ohio', 'gyatt', 'npc', 'tung', 'sahur', 'crocodilo', 'bombardiro', 'cappuccino', 'assassino', 'tralalero', 'italian brainrot', 'tiktok', 'gen z', 'mr beast', 'mrbeast', 'aura', 'cringe', 'w rizz', 'sus'],
    pairings: [
      P('caption_punch', 'bangers', 'rubik', { numerals: 'bangers', dcase: 'upper', treatment: 'heavy', ratio: [1.25, 1.333] }),
      P('sticker', 'dela_gothic', 'outfit', { numerals: 'dela_gothic', treatment: 'heavy', ratio: [1.25, 1.3] }),
      P('bubble_pop', 'chewy', 'baloo', { treatment: 'outline', ratio: [1.25, 1.333], base: [16, 17] }),
    ],
  },
  {
    id: 'cartoon_action', fallback: ['ArialRoundedMTBold', 'Futura'],
    words: ['subway surfers', 'runner', 'endless runner', 'chase', 'cartoon', 'slapstick', 'angry birds', 'fruit ninja', 'crossy road', 'temple run', 'dash', 'jump', 'dodge', 'launch', 'slingshot', 'smash', 'platformer', 'mario', 'sonic', 'shooter', 'blast', 'bomb'],
    pairings: [
      P('comic_burst', 'bangers', 'baloo', { numerals: 'bangers', dcase: 'upper', treatment: 'heavy', ratio: [1.25, 1.333] }),
      P('toybox', 'bowlby', 'fredoka', { numerals: 'bowlby', treatment: 'heavy' }),
      P('saturday', 'chewy', 'rubik', { numerals: 'archivo_black', treatment: 'outline', ratio: [1.25, 1.3] }),
    ],
  },
  {
    id: 'cute_collectible', fallback: ['ArialRoundedMTBold', 'Avenir Next'],
    words: ['cute', 'kawaii', 'toy', 'toys', 'blind box', 'labubu', 'pop mart', 'plush', 'collectible', 'collection', 'sticker', 'squishmallow', 'sanrio', 'hello kitty', 'bunny', 'kitten', 'puppy', 'pastel', 'cozy', 'chibi', 'figure'],
    pairings: [
      P('shop_tag', 'chewy', 'nunito', { numerals: 'fredoka', treatment: 'none', ratio: [1.2, 1.25], base: [16, 17] }),
      P('soft_box', 'baloo', 'mplus_rounded', { numerals: 'baloo', title: 'display', treatment: 'none', ratio: [1.25, 1.3] }),
      P('ribbon', 'pacifico', 'fredoka', { title: 'text', treatment: 'none', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'garden_cozy', fallback: ['Baskerville', 'Avenir Next'],
    words: ['garden', 'plant', 'plants', 'houseplant', 'houseplants', 'windowsill', 'flower', 'flowers', 'farm', 'seed', 'seeds', 'sunflower', 'cottage', 'picnic', 'bugs', 'bee', 'bees', 'meadow', 'greenhouse', 'plants vs zombies', 'veggie', 'harvest'],
    pairings: [
      P('seed_packet', 'alfa_slab', 'work_sans', { numerals: 'alfa_slab', lcase: 'upper', treatment: 'none', ratio: [1.2, 1.25] }),
      P('potting_shed', 'dm_serif', 'nunito', { title: 'display', treatment: 'none', ratio: [1.25, 1.3] }),
      P('field_notes', 'caveat', 'mplus_rounded', { numerals: 'fredoka', title: 'display', treatment: 'none', ratio: [1.25, 1.333], base: [16, 17] }),
    ],
  },
  {
    id: 'medieval_quest', fallback: ['Baskerville', 'Georgia'],
    words: ['medieval', 'fantasy', 'king', 'queen', 'castle', 'knight', 'dragon', 'kingdom', 'peasant', 'wizard', 'quest', 'sword', 'throne', 'crown', 'realm', 'dungeon', 'rpg', 'tavern', 'elf', 'witch', 'magic', 'zelda', 'skyrim'],
    pairings: [
      P('illuminated', 'uncial', 'lora', { title: 'display', treatment: 'none', ratio: [1.25, 1.3] }),
      P('royal_decree', 'cinzel', 'libre_baskerville', { dcase: 'upper', lcase: 'upper', ltrack: 0.08, ratio: [1.2, 1.25], base: [15, 16] }),
      P('tavern_board', 'unifraktur', 'im_fell', { title: 'display', treatment: 'none', ratio: [1.25, 1.3], base: [16, 17] }),
    ],
  },
  {
    id: 'myth_ancient', fallback: ['Baskerville', 'Georgia'],
    words: ['greek', 'mythology', 'myth', 'gods', 'god', 'zeus', 'olympus', 'norse', 'odin', 'thor', 'egyptian', 'pharaoh', 'roman', 'ancient', 'legend', 'titan', 'athena', 'hades', 'temple', 'oracle', 'krillion'],
    pairings: [
      P('marble', 'cinzel', 'cormorant', { dcase: 'upper', lcase: 'upper', ltrack: 0.1, ratio: [1.25, 1.3], base: [16, 17] }),
      P('scroll', 'playfair', 'lora', { title: 'display', ratio: [1.25, 1.333] }),
      P('oracle', 'dm_serif', 'cormorant', { lcase: 'upper', treatment: 'outline', ratio: [1.2, 1.25], base: [16, 17] }),
    ],
  },
  {
    id: 'spooky', fallback: ['Baskerville', 'Chalkboard SE'],
    words: ['horror', 'spooky', 'haunted', 'ghost', 'ghosts', 'halloween', 'zombie', 'zombies', 'vampire', 'creepy', 'scary', 'monster', 'skeleton', 'witch', 'graveyard', 'nightmare', 'dark bedroom', 'cursed'],
    pairings: [
      P('drip', 'creepster', 'im_fell', { treatment: 'heavy', ratio: [1.25, 1.333], base: [16, 17] }),
      P('crypt', 'unifraktur', 'cormorant', { treatment: 'outline', ratio: [1.25, 1.3], base: [16, 17] }),
      P('case_file', 'special_elite', 'space_mono', { title: 'display', treatment: 'none', ratio: [1.2, 1.25], base: [15, 16] }),
    ],
  },
  {
    id: 'noir_mystery', fallback: ['American Typewriter', 'Baskerville'],
    words: ['noir', 'detective', 'mystery', 'murder', 'clue', 'heist', 'crime', 'case', 'secret', 'agent', 'lateral thinking', 'riddle', 'puzzle box', 'escape room', 'whodunit', 'suspect', 'evidence', 'interrogation'],
    pairings: [
      P('typewriter', 'special_elite', 'courier_prime', { title: 'display', lcase: 'upper', ratio: [1.2, 1.25], base: [15, 16] }),
      P('headline', 'abril', 'libre_baskerville', { ratio: [1.25, 1.333], base: [15, 16] }),
      P('dossier', 'playfair', 'space_mono', { numerals: 'space_mono', lcase: 'upper', ratio: [1.25, 1.3], base: [15, 16] }),
    ],
  },
  {
    id: 'office_corporate', fallback: ['Avenir Next', 'Helvetica Neue'],
    words: ['office', 'corporate', 'boss', 'email', 'emails', 'spam', 'inbox', 'work', 'meeting', 'friday', 'manager', 'coworker', 'cubicle', 'slack', 'spreadsheet', 'deadline', 'ceo', 'job', 'interview', 'linkedin', '4:59'],
    pairings: [
      P('memo', 'archivo_black', 'dm_sans', { numerals: 'space_mono', ratio: [1.2, 1.25] }),
      P('all_hands', 'space_grotesk', 'work_sans', { numerals: 'share_tech_mono', title: 'display', ratio: [1.25, 1.3] }),
      P('fine_print', 'dela_gothic', 'archivo', { lcase: 'upper', ratio: [1.2, 1.25], base: [15, 16] }),
    ],
  },
  {
    id: 'racing_sport', fallback: ['AvenirNextCondensed-HeavyItalic', 'Avenir Next Condensed'],
    words: ['f1', 'formula 1', 'formula one', 'racing', 'race', 'racer', 'car', 'cars', 'kart', 'verstappen', 'hamilton', 'grand prix', 'speed', 'lap', 'nascar', 'sport', 'sports', 'football', 'soccer', 'basketball', 'nba', 'nfl', 'tennis', 'golf', 'olympics', 'stadium', 'goal'],
    pairings: [
      P('pit_wall', 'barlow_cond_italic', 'barlow_cond', { numerals: 'teko', dcase: 'upper', lcase: 'upper', treatment: 'outline', ratio: [1.25, 1.333], base: [16, 17] }),
      P('scoreboard', 'teko', 'oswald', { numerals: 'teko', dcase: 'upper', lcase: 'upper', ratio: [1.3, 1.333], base: [16, 17] }),
      P('jersey', 'archivo_black', 'archivo', { numerals: 'teko', dcase: 'upper', treatment: 'heavy', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'wild_west', fallback: ['Rockwell', 'American Typewriter'],
    words: ['western', 'cowboy', 'cowgirl', 'desert', 'saloon', 'wild west', 'outlaw', 'sheriff', 'rodeo', 'ranch', 'gold rush', 'bandit', 'frontier', 'red dead'],
    pairings: [
      P('wanted', 'rye', 'courier_prime', { dcase: 'upper', lcase: 'upper', treatment: 'none', ratio: [1.25, 1.3] }),
      P('saloon', 'alfa_slab', 'lora', { lcase: 'upper', treatment: 'outline', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'midcentury', fallback: ['Snell Roundhand', 'Futura'],
    words: ['1950s', '50s', 'fifties', '1960s', '60s', 'sixties', '1970s', '70s', 'seventies', 'diner', 'rockabilly', 'jukebox', 'drive-in', 'milkshake', 'disco', 'groovy', 'hippie', 'retro', 'vintage', 'mid-century', 'doo-wop', 'atomic'],
    pairings: [
      P('neon_diner', 'lobster', 'josefin', { lcase: 'upper', ltrack: 0.1, treatment: 'outline', ratio: [1.25, 1.333] }),
      P('jukebox', 'pacifico', 'outfit', { lcase: 'upper', treatment: 'none', ratio: [1.25, 1.3] }),
      P('poster', 'abril', 'josefin', { numerals: 'abril', ratio: [1.25, 1.333] }),
    ],
  },
  {
    id: 'jazz_deco', fallback: ['Futura', 'Didot'],
    words: ['1920s', '20s', 'twenties', 'gatsby', 'jazz', 'art deco', 'deco', 'speakeasy', 'roaring', 'flapper', 'cabaret', 'casino', 'poker', 'blackjack', 'cocktail', 'hotel', 'hostess'],
    pairings: [
      P('marquee_deco', 'poiret', 'josefin', { dcase: 'upper', lcase: 'upper', ltrack: 0.14, ratio: [1.25, 1.3], base: [16, 17] }),
      P('lounge', 'playfair', 'cormorant', { lcase: 'upper', ratio: [1.25, 1.333], base: [16, 17] }),
    ],
  },
  {
    id: 'elegant', fallback: ['Didot', 'Baskerville'],
    words: ['fashion', 'luxury', 'perfume', 'wedding', 'ballet', 'museum', 'art', 'painting', 'classical', 'opera', 'chess', 'royal', 'jewelry', 'vogue', 'catwalk', 'tea', 'paris', 'french', 'france', 'wine'],
    pairings: [
      P('editorial', 'playfair', 'dm_sans', { lcase: 'upper', ltrack: 0.08, ratio: [1.25, 1.333] }),
      P('gallery', 'dm_serif', 'josefin', { ratio: [1.2, 1.25], base: [16, 17] }),
      P('salon', 'abril', 'lora', { lcase: 'upper', ratio: [1.25, 1.3] }),
    ],
  },
  {
    id: 'notebook', fallback: ['Noteworthy', 'Chalkboard SE'],
    words: ['school', 'notebook', 'doodle', 'sketch', 'homework', 'math', 'teacher', 'class', 'crayon', 'chalk', 'learn', 'learning', 'study', 'spelling', 'kids', 'homemade', 'diy', 'craft', 'scrapbook', 'journal'],
    pairings: [
      P('margins', 'caveat', 'patrick_hand', { numerals: 'patrick_hand', ratio: [1.25, 1.333], base: [16, 17] }),
      P('chalkboard', 'chewy', 'patrick_hand', { treatment: 'outline', ratio: [1.25, 1.3], base: [16, 17] }),
      P('workbook', 'alfa_slab', 'nunito', { numerals: 'nunito', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'tropical', fallback: ['Snell Roundhand', 'Avenir Next'],
    words: ['beach', 'ocean', 'tropical', 'island', 'surf', 'surfing', 'summer', 'tiki', 'hawaii', 'luau', 'pirate', 'pirates', 'treasure', 'shark', 'reef', 'mermaid', 'vacation', 'sunset', 'pool'],
    pairings: [
      P('surf_shop', 'pacifico', 'nunito', { title: 'text', treatment: 'outline', ratio: [1.25, 1.3] }),
      P('tiki', 'righteous', 'outfit', { lcase: 'upper', treatment: 'outline', ratio: [1.2, 1.25] }),
      P('treasure_map', 'rye', 'lora', { treatment: 'none', ratio: [1.25, 1.3] }),
    ],
  },
  {
    id: 'wild_nature', fallback: ['Avenir Next', 'Baskerville'],
    words: ['wildlife', 'safari', 'animal', 'animals', 'jungle', 'zoo', 'nature', 'photo', 'photography', 'camera', 'forest', 'birds', 'bird', 'cat', 'cats', 'dog', 'dogs', 'alley', 'stray', 'fox', 'bear', 'lion'],
    pairings: [
      P('field_guide', 'dm_serif', 'work_sans', { lcase: 'upper', ratio: [1.25, 1.3] }),
      P('ranger', 'alfa_slab', 'oswald', { numerals: 'teko', lcase: 'upper', ratio: [1.25, 1.333], base: [16, 17] }),
      P('trail_sign', 'oswald', 'nunito', { dcase: 'upper', title: 'display', ratio: [1.25, 1.3] }),
    ],
  },
  {
    id: 'food_fun', fallback: ['ArialRoundedMTBold', 'Snell Roundhand'],
    words: ['food', 'cooking', 'cook', 'chef', 'kitchen', 'cake', 'bakery', 'bake', 'pizza', 'burger', 'toast', 'butter', 'snack', 'snacks', 'candy', 'restaurant', 'fruit', 'pineapple', 'pineapples', 'coffee', 'cafe', 'donut', 'sushi', 'taco', 'breakfast'],
    pairings: [
      P('menu_board', 'lobster', 'rubik', { numerals: 'rubik', treatment: 'outline', ratio: [1.25, 1.3] }),
      P('candy_wrapper', 'chewy', 'outfit', { treatment: 'heavy', ratio: [1.25, 1.333] }),
      P('diner_sign', 'bowlby', 'rubik', { numerals: 'bowlby', dcase: 'upper', treatment: 'outline', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'music_party', fallback: ['Futura', 'Avenir Next Condensed'],
    words: ['music', 'rhythm', 'beat', 'dance', 'dj', 'party', 'concert', 'karaoke', 'melody', 'synth', 'song', 'band', 'rock', 'pop star', 'festival', 'club', 'rave', 'guitar', 'piano', 'tune'],
    pairings: [
      P('club_flyer', 'monoton', 'josefin', { numerals: 'teko', dcase: 'upper', lcase: 'upper', ltrack: 0.12, ratio: [1.25, 1.3] }),
      P('setlist', 'righteous', 'dm_sans', { numerals: 'share_tech_mono', treatment: 'outline', ratio: [1.25, 1.333] }),
      P('mixtape', 'syne', 'space_grotesk', { numerals: 'space_mono', title: 'text', ratio: [1.2, 1.25] }),
    ],
  },
  {
    id: 'word_puzzle', fallback: ['Avenir Next', 'Helvetica Neue'],
    words: ['word', 'words', 'wordle', 'crossword', 'connections', 'anagram', 'letters', 'spelling bee', 'puzzle', 'logic', 'sudoku', '2048', 'minesweeper', 'grid', 'match', 'memory', 'tiles', 'numbers', '24'],
    pairings: [
      P('newsprint', 'abril', 'dm_sans', { numerals: 'space_mono', ratio: [1.2, 1.25] }),
      P('tile_rack', 'archivo_black', 'work_sans', { numerals: 'archivo_black', dcase: 'upper', ratio: [1.25, 1.3] }),
      P('grid_paper', 'space_grotesk', 'space_grotesk', { numerals: 'space_mono', title: 'display', ratio: [1.25, 1.333] }),
    ],
  },
  {
    id: 'trivia_world', fallback: ['Avenir Next', 'Futura'],
    words: ['trivia', 'quiz', 'geography', 'map', 'maps', 'country', 'countries', 'capital', 'flag', 'flags', 'world', 'travel', 'saying', 'sayings', 'history', 'facts', 'rank', 'rating', 'tier', 'guess', 'brands', 'decade'],
    pairings: [
      P('atlas', 'dm_serif', 'outfit', { numerals: 'outfit', lcase: 'upper', ratio: [1.25, 1.3] }),
      P('passport', 'josefin', 'work_sans', { numerals: 'teko', dcase: 'upper', lcase: 'upper', ltrack: 0.1, ratio: [1.25, 1.333] }),
      P('quiz_card', 'righteous', 'rubik', { numerals: 'rubik', treatment: 'none', ratio: [1.2, 1.25] }),
    ],
  },
  {
    // The fallback when no other vibe's words match. Still three different pairings.
    id: 'clean_modern', fallback: ['Avenir Next', 'Helvetica Neue'],
    words: [],
    pairings: [
      P('studio', 'syne', 'dm_sans', { title: 'text', ratio: [1.2, 1.25] }),
      P('geometric', 'outfit', 'outfit', { numerals: 'space_mono', ratio: [1.25, 1.3] }),
      P('grotesk', 'archivo_black', 'outfit', { ratio: [1.2, 1.25] }),
    ],
  },
];

// The characterful pairings per vibe (art direction v2): the most expressive display face that
// suits the vibe, for titles, HUD numbers and big words, on a readable text face. The art pipeline
// (chooseLook with {characterful: true}) picks among these first; `pairings` stay as they were, so
// every game already pinned to one (art.type) keeps its fonts. Pairing ids are unique per vibe.
export const BOLD = {
  game_show: [
    P('neon_marquee', 'bungee_shade', 'archivo', { numerals: 'teko', dcase: 'upper', lcase: 'upper', treatment: 'none', ratio: [1.25, 1.3] }),
    P('pop_quiz', 'luckiest', 'rubik', { numerals: 'luckiest', treatment: 'heavy', ratio: [1.25, 1.3] }),
  ],
  retro_80s: [
    P('outrun', 'monoton', 'barlow_cond', { numerals: 'vt323', lcase: 'upper', ltrack: 0.12, ratio: [1.25, 1.3], base: [16, 17] }),
    P('arcade_mall', 'bungee_shade', 'josefin', { numerals: 'teko', lcase: 'upper', treatment: 'none' }),
  ],
  pixel_arcade: [
    P('high_score', 'press_start', 'vt323', { numerals: 'press_start', dcase: 'upper', lcase: 'upper', treatment: 'heavy', base: [17, 17], ratio: [1.2, 1.25] }),
    P('block_party', 'rubik_mono', 'space_mono', { numerals: 'press_start', lcase: 'upper', treatment: 'outline', ratio: [1.2, 1.25] }),
  ],
  space_saga: [
    P('warp', 'zen_dots', 'space_grotesk', { numerals: 'share_tech_mono', lcase: 'upper', ltrack: 0.1, ratio: [1.2, 1.25] }),
  ],
  cyber_tech: [
    P('ops', 'black_ops', 'share_tech_mono', { numerals: 'share_tech_mono', lcase: 'upper', ratio: [1.2, 1.25] }),
    P('overclock', 'zen_dots', 'space_mono', { numerals: 'space_mono', ratio: [1.2, 1.25], base: [15, 16] }),
  ],
  meme_brainrot: [
    P('chonk', 'bagel', 'rubik', { numerals: 'bagel', treatment: 'heavy', ratio: [1.25, 1.333] }),
    P('sharpie_caption', 'permanent_marker', 'outfit', { numerals: 'luckiest', treatment: 'heavy', ratio: [1.25, 1.3] }),
    P('loud', 'luckiest', 'baloo', { numerals: 'luckiest', treatment: 'heavy', ratio: [1.25, 1.333] }),
  ],
  cartoon_action: [
    P('cartoon_title', 'luckiest', 'fredoka', { numerals: 'luckiest', treatment: 'heavy', ratio: [1.25, 1.333] }),
    P('chunky', 'titan', 'rubik', { numerals: 'titan', treatment: 'heavy', ratio: [1.25, 1.3] }),
  ],
  cute_collectible: [
    P('bagel_shop', 'bagel', 'nunito', { numerals: 'bagel', treatment: 'none', ratio: [1.2, 1.25], base: [16, 17] }),
    P('cherry', 'cherry_bomb', 'mplus_rounded', { numerals: 'fredoka', treatment: 'none', ratio: [1.25, 1.3] }),
    P('gumdrop', 'lilita', 'fredoka', { numerals: 'lilita', treatment: 'outline', ratio: [1.2, 1.25] }),
  ],
  garden_cozy: [
    P('greenhouse', 'boogaloo', 'nunito', { numerals: 'fredoka', treatment: 'none', ratio: [1.25, 1.3], base: [16, 17] }),
    P('seedling', 'titan', 'work_sans', { numerals: 'titan', treatment: 'none', ratio: [1.2, 1.25] }),
  ],
  medieval_quest: [
    P('banner', 'pirata', 'lora', { treatment: 'none', ratio: [1.25, 1.3], base: [16, 17] }),
  ],
  spooky: [
    P('slasher', 'nosifer', 'cormorant', { treatment: 'outline', ratio: [1.2, 1.25], base: [16, 17] }),
    P('creature_feature', 'creepster', 'courier_prime', { numerals: 'courier_prime', treatment: 'heavy', ratio: [1.25, 1.333], base: [15, 16] }),
  ],
  noir_mystery: [
    P('pulp_cover', 'shrikhand', 'courier_prime', { lcase: 'upper', ratio: [1.25, 1.3], base: [15, 16] }),
  ],
  office_corporate: [
    P('sticky_note', 'permanent_marker', 'dm_sans', { numerals: 'space_mono', ratio: [1.2, 1.25] }),
  ],
  racing_sport: [
    P('checkered', 'faster', 'barlow_cond', { numerals: 'teko', dcase: 'upper', lcase: 'upper', treatment: 'outline', ratio: [1.25, 1.3], base: [16, 17] }),
    P('podium', 'racing_sans', 'oswald', { numerals: 'teko', dcase: 'upper', lcase: 'upper', treatment: 'heavy', ratio: [1.25, 1.333], base: [16, 17] }),
  ],
  wild_west: [
    P('wanted_poster', 'rye', 'barlow_cond', { numerals: 'rye', dcase: 'upper', lcase: 'upper', treatment: 'outline', ratio: [1.25, 1.3], base: [16, 17] }),
  ],
  midcentury: [
    P('groovy', 'shrikhand', 'josefin', { lcase: 'upper', ltrack: 0.1, treatment: 'outline', ratio: [1.25, 1.333] }),
    P('far_out', 'boogaloo', 'outfit', { treatment: 'none', ratio: [1.25, 1.3] }),
  ],
  jazz_deco: [
    P('deco_neon', 'monoton', 'cormorant', { lcase: 'upper', ltrack: 0.12, ratio: [1.25, 1.3], base: [16, 17] }),
  ],
  notebook: [
    P('marker', 'permanent_marker', 'patrick_hand', { numerals: 'patrick_hand', ratio: [1.25, 1.333], base: [16, 17] }),
  ],
  tropical: [
    P('surf_brush', 'knewave', 'nunito', { treatment: 'outline', ratio: [1.25, 1.3] }),
    P('jolly_roger', 'pirata', 'outfit', { lcase: 'upper', treatment: 'none', ratio: [1.25, 1.3] }),
  ],
  wild_nature: [
    P('trail_badge', 'lilita', 'work_sans', { numerals: 'lilita', lcase: 'upper', ratio: [1.25, 1.3] }),
  ],
  food_fun: [
    P('candy_shop', 'bagel', 'outfit', { numerals: 'bagel', treatment: 'heavy', ratio: [1.25, 1.333] }),
    P('soda_fountain', 'shrikhand', 'rubik', { numerals: 'lilita', treatment: 'outline', ratio: [1.25, 1.3] }),
    P('snack_pack', 'lilita', 'rubik', { numerals: 'lilita', treatment: 'heavy', ratio: [1.2, 1.25] }),
  ],
  music_party: [
    P('headbanger', 'metal_mania', 'barlow_cond', { numerals: 'teko', lcase: 'upper', treatment: 'outline', ratio: [1.25, 1.3], base: [16, 17] }),
    P('tag_wall', 'sedgwick', 'rubik', { numerals: 'teko', treatment: 'heavy', ratio: [1.25, 1.333] }),
    P('synth_club', 'monoton', 'dm_sans', { numerals: 'share_tech_mono', ratio: [1.25, 1.3] }),
  ],
  word_puzzle: [
    P('letter_blocks', 'rubik_mono', 'work_sans', { numerals: 'rubik_mono', ratio: [1.2, 1.25] }),
    P('chunky_tiles', 'lilita', 'dm_sans', { numerals: 'lilita', ratio: [1.25, 1.3] }),
  ],
  trivia_world: [
    P('globe_show', 'titan', 'outfit', { numerals: 'titan', treatment: 'outline', ratio: [1.2, 1.25] }),
  ],
  clean_modern: [
    P('punchy', 'lilita', 'outfit', { ratio: [1.2, 1.25] }),
    P('mono_pop', 'rubik_mono', 'dm_sans', { numerals: 'space_mono', ratio: [1.2, 1.25] }),
  ],
};
for (const v of VIBES) v.bold = BOLD[v.id] ?? [];

export const VIBE_IDS = VIBES.map((v) => v.id);
export const DEFAULT_VIBE = 'clean_modern';
