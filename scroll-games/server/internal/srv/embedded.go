package srv

// Last-resort copies of spec/templates/*, used only when the spec directory is unreadable.
// TestEmbeddedTemplatesMatchSpec keeps them identical to the files.

const embeddedQuizManifest = `{
  "schema": "sg.manifest/1",
  "title": "Trip Trivia",
  "description": "How well do you remember our trip?",
  "level": "remix",
  "template": "quiz",
  "seed_scope": "per_challenge",
  "concepts": [
    { "id": "flow.session", "params": {} },
    { "id": "flow.countdown_start", "params": { "seconds": 3 } },
    { "id": "flow.rounds", "params": { "rounds": 8, "reveal_ms": 900 } },
    { "id": "content.question_bank", "params": {} },
    { "id": "content.photo_prompt", "params": { "fit": "cover" } },
    { "id": "space.choice_board", "params": { "layout": "grid" } },
    { "id": "input.tap_choice", "params": {} },
    { "id": "rule.round_timer", "params": { "round_ms": 10000 } },
    { "id": "rule.single_answer", "params": {} },
    { "id": "score.points", "params": { "per_correct": 100 } },
    { "id": "score.time_bonus", "params": { "max_bonus": 50 } },
    { "id": "score.streak_multiplier", "params": { "every": 3, "step": 1, "max": 3 } },
    { "id": "feedback.flash", "params": {} },
    { "id": "feedback.haptic", "params": {} },
    { "id": "feedback.confetti", "params": { "min_streak": 0 } },
    { "id": "meta.seeded_random", "params": {} },
    { "id": "share.score_card", "params": { "headline": "Trip Trivia" } },
    { "id": "social.beat_them", "params": {} },
    { "id": "feel.theme", "params": { "palette": "sunset", "mood": "playful", "emoji": "🌍" } }
  ],
  "glue": [
    {
      "id": "double_final_round",
      "on": ["round.started", "answer.correct"],
      "script": "fn on_event(ev) {\n    let final_round = get(\"round\") == get(\"total_rounds\");\n    if !final_round { return; }\n    if ev.name == \"round.started\" {\n        set(\"banner\", \"Final round — double points!\");\n    } else if ev.name == \"answer.correct\" {\n        // score.points and score.time_bonus already ran; award the same again.\n        set(\"score\", get(\"score\") + get(\"round_points\"));\n        emit(\"glue.double_applied\", #{ round: get(\"round\") });\n    }\n}\n"
    }
  ],
  "theme": { "palette": "sunset", "mood": "playful", "emoji": "🌍" }
}`

const embeddedQuizContent = `{
  "schema": "sg.content/1",
  "items": [
    { "id": "q1", "kind": "question", "prompt": "Where was this sunset?", "media_id": "m1", "media_url": "https://picsum.photos/seed/sg-m1/600/400",
      "choices": ["Lisbon", "Porto", "Sintra", "Cascais"], "answer": 0, "clue": "We watched it from the miradouro after the tram ride." },
    { "id": "q2", "kind": "question", "prompt": "What did we eat at this table?", "media_id": "m2", "media_url": "https://picsum.photos/seed/sg-m2/600/400",
      "choices": ["Pasteis de nata", "Bacalhau", "Francesinha", "Caldo verde"], "answer": 1, "clue": "Salt cod, three ways." },
    { "id": "q3", "kind": "question", "prompt": "Who took the wrong train here?", "media_id": "m3", "media_url": "https://picsum.photos/seed/sg-m3/600/400",
      "choices": ["Ana", "Bayan", "Diego", "Mina"], "answer": 2, "clue": "He still insists the signs were misleading." },
    { "id": "q4", "kind": "question", "prompt": "Which day was this hike?", "media_id": "m4", "media_url": "https://picsum.photos/seed/sg-m4/600/400",
      "choices": ["Monday", "Tuesday", "Wednesday", "Thursday"], "answer": 3, "clue": "The day before the rain." },
    { "id": "q5", "kind": "question", "prompt": "What was the name of this cafe?", "media_id": "m5", "media_url": "https://picsum.photos/seed/sg-m5/600/400",
      "choices": ["Cafe Luz", "Brasileira", "Pastelaria Sol", "Cantinho"], "answer": 1, "clue": "Famous for its statue out front." },
    { "id": "q6", "kind": "question", "prompt": "How many of us fit in this tuk-tuk?", "media_id": "m6", "media_url": "https://picsum.photos/seed/sg-m6/600/400",
      "choices": ["Three", "Four", "Five", "Six"], "answer": 2, "clue": "Count the knees." },
    { "id": "q7", "kind": "question", "prompt": "What souvenir did Mina buy here?", "media_id": "m7", "media_url": "https://picsum.photos/seed/sg-m7/600/400",
      "choices": ["Azulejo tile", "Sardine tin", "Cork bag", "Rooster magnet"], "answer": 0, "clue": "It is on her fridge now." },
    { "id": "q8", "kind": "question", "prompt": "Where did this group photo happen?", "media_id": "m8", "media_url": "https://picsum.photos/seed/sg-m8/600/400",
      "choices": ["Castelo de Sao Jorge", "Belem Tower", "Pena Palace", "Roman bridge"], "answer": 2, "clue": "Yellow and red walls, lots of stairs." }
  ],
  "copy": {
    "intro": "How well do you remember our trip?",
    "win": "You remember everything. Ana owes you a pastel.",
    "lose": "Did you even come with us?"
  }
}`
