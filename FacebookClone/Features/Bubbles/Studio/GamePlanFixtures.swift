#if DEBUG
import Foundation

/// DEBUG-only plan replies for SwiftUI previews and screenshots of the Plan step. They are written
/// in the server's wire shape (`POST /v1/harness/plan`) and go through the same decoder, so they
/// also check that `GamePlan` reads what the server sends. Never compiled into release builds.
///
/// `FB_STUDIO_PLAN`:
/// - `normal`: a count-in-time game, no questions, sent as a best of 3.
/// - `questions`: a rare-answer quiz with 2 questions, a Group round.
/// - `gap`: a guessing game that needs a map the engine doesn't have yet.
/// - `opinion`: a tier list with no right answer: unranked, compare picks.
/// - `story`: a choose-your-path story ranked by its ending.
/// - `loading`: never answers (the planning state).
/// - `failed`: Muse couldn't plan it (the Try again state).
/// - `off`: planning is turned off on the server (the step steps aside).
enum GamePlanFixtures {
    static func answer(_ name: String, request: String) async throws -> HarnessPlanClient.Outcome {
        switch name {
        case "loading":
            try await Task.sleep(nanoseconds: 600_000_000_000)
            return .unavailable
        case "off":
            return .unavailable
        case "failed":
            try await Task.sleep(nanoseconds: 1_500_000_000)
            throw GamesAPIError.server(status: 502, message: "Muse couldn't plan this game, try again")
        default:
            try await Task.sleep(nanoseconds: 2_500_000_000)
            return .plan(plan(name))
        }
    }

    static func plan(_ name: String) -> GamePlan {
        let json: String
        switch name {
        case "questions": json = questions
        case "gap": json = gap
        case "opinion": json = opinion
        case "story": json = story
        default: json = normal
        }
        return (try? GamePlan.decode(Data(json.utf8))) ?? GamePlan(reply: .object([:]))
    }

    // MARK: Replies

    static let normal = """
    {"plan": {"anatomy": {"anatomy": "game-anatomy/0.1", "title": "Pancake Rush", "genre": "action"},
      "design": {"pitch": "Flip and stack pancakes for a hungry diner before the bell."},
      "type_ids": ["order_rush"], "tool_ids": ["tap_target", "timer_bar", "score"], "gaps": [], "clarify": []},
     "clarify": [{"slot": "theme", "value": "a diner kitchen", "guessed": false}],
     "spec": {"spec": "game-spec/1",
      "theme": {"world": "A busy weekend diner kitchen", "named": [], "tone": "playful", "look": "warm"},
      "goal": {"text": "Serve as many pancake orders as you can before the bell", "target": "finish the most orders", "measure": "orders completed"},
      "loop": {"verb": "tap", "sees": "an order ticket and a griddle", "input": "tap", "feedback": "the plate slides out with a ding", "cycle_seconds": 4},
      "constraints": {"items": [{"kind": "time", "value": "60 s", "enforced_by": "timer", "hud": "timer bar"}]},
      "end": {"win": "", "lose": "", "ends_when": ["time_up"], "session_seconds": [60, 60]},
      "score": {"kind": "count_in_time", "measures": "orders completed before the bell", "unit": "orders", "direction": "higher", "counts_when": "any", "format": "{n} orders"},
      "social": {"mode": "series", "best_of": 3, "round_seconds": 60, "result": {"kind": "score", "compare": "score", "display": "{score}"}, "share_line": "{name}: {result} on {title}. Your turn.", "same_seed": true}},
     "types": [{"id": "order_rush", "name": "Order rush", "family": "management_sim", "score": 0.82}],
     "timings": {"understand_ms": 6100, "retrieve_ms": 12, "lookup_ms": 0, "plan_ms": 24800, "total_ms": 31000}}
    """

    static let questions = """
    {"plan": {"anatomy": {"title": "The Rarest Spell"},
      "design": {"pitch": "Name a spell nobody else thinks of."},
      "type_ids": ["rare_answer_trivia"], "tool_ids": ["typed_answer", "fuzzy_match", "timer_bar"], "gaps": []},
     "clarify": [
      {"slot": "theme", "value": "Harry Potter", "guessed": false},
      {"slot": "difficulty", "value": "fans", "guessed": true, "question": "Who's playing?", "choices": ["Casual fans", "Superfans", "A mix"]},
      {"slot": "prompt_count", "value": "5", "guessed": true, "question": "How many prompts?", "choices": ["3 quick ones", "5", "10"]}],
     "spec": {"spec": "game-spec/1",
      "theme": {"world": "The wizarding world of Harry Potter", "named": ["Harry Potter"], "tone": "cozy"},
      "goal": {"text": "Find the rarest right answer for each prompt", "target": "find the rarest answer in each of 5 prompts", "measure": "rarity points"},
      "loop": {"verb": "type", "sees": "a category like 'a spell' and a 10-second timer", "input": "type", "feedback": "how rare your answer was", "cycle_seconds": 12},
      "end": {"win": "", "lose": "", "ends_when": ["all_prompts_done"], "session_seconds": [60, 90]},
      "score": {"kind": "tiered_points", "measures": "rarity points per answer", "unit": "points", "direction": "higher", "format": "{n} points"},
      "social": {"mode": "group_round", "round_seconds": 75, "result": {"kind": "score", "compare": "score"}, "share_line": "{name}: {result} on {title}. Your turn."}},
     "types": [{"id": "rare_answer_trivia", "name": "Rare-answer trivia", "family": "trivia", "score": 0.91, "reasons": ["alias: Krillion"]}],
     "timings": {"understand_ms": 5200, "retrieve_ms": 9, "lookup_ms": 0, "plan_ms": 27400, "total_ms": 32700}}
    """

    static let gap = """
    {"plan": {"anatomy": {"title": "Where in the World"},
      "design": {"pitch": "Guess the country from three clues, fastest wins."},
      "type_ids": ["clue_guess"], "tool_ids": ["typed_answer", "fuzzy_match", "timer_bar"],
      "gaps": [{"tool": "world_map", "status": "gap", "approximation": "the country's name and flag colors are shown instead of a map", "familiarity": "approximate"}]},
     "clarify": [],
     "spec": {"spec": "game-spec/1",
      "theme": {"world": "Travel postcards from around the world", "tone": "curious"},
      "goal": {"text": "Name all 8 countries as fast as you can", "target": "name 8 countries", "measure": "time to finish"},
      "loop": {"verb": "guess", "sees": "three clues about a country", "input": "type", "feedback": "a stamp on your passport"},
      "end": {"win": "all 8 countries named", "ends_when": ["target_reached"], "session_seconds": [45, 120]},
      "score": {"kind": "time_to_complete", "unit": "ms", "direction": "lower", "counts_when": "finished", "format": "m:ss.t"},
      "social": {"mode": "same_seed_async", "result": {"kind": "score", "compare": "score"}}},
     "types": [{"id": "clue_guess", "name": "Clue-by-clue guessing", "family": "knowledge_quiz", "score": 0.74}],
     "timings": {"total_ms": 29000}}
    """

    static let opinion = """
    {"plan": {"anatomy": {"title": "Topping Tiers"},
      "design": {"pitch": "Rank pizza toppings from S to F, then see who agrees."},
      "type_ids": ["tier_list"], "tool_ids": ["drag_sort", "tier_rows"], "gaps": []},
     "clarify": [{"slot": "items", "value": "12 pizza toppings", "guessed": true}],
     "spec": {"spec": "game-spec/1",
      "theme": {"world": "A pizza night with friends", "tone": "silly"},
      "goal": {"text": "Put every topping in a tier", "target": "place all 12 toppings", "measure": "toppings placed"},
      "loop": {"verb": "sort", "sees": "a topping card and five tier rows", "input": "drag", "feedback": "the card snaps into its row"},
      "end": {"win": "every topping placed", "ends_when": ["all_prompts_done"], "session_seconds": [40, 90]},
      "score": {"kind": "points", "direction": "higher", "ranked": false},
      "social": {"mode": "opinion_compare", "result": {"kind": "picks", "compare": "agreement", "display": "{agreement}% in sync with {name}", "state": ["picks"]}, "share_line": "{name} ranked {title}. Your turn."}},
     "types": [{"id": "tier_list", "name": "Tier list", "family": "party_social", "score": 0.88}],
     "timings": {"total_ms": 26000}}
    """

    static let story = """
    {"plan": {"anatomy": {"title": "Peasant to Crown"},
      "design": {"pitch": "Rise from turnip farmer to ruler in 10 choices or less."},
      "type_ids": ["choice_limit_quest"], "tool_ids": ["choice_story", "story_vars"],
      "gaps": [{"tool": "branching_story", "status": "building", "approximation": "the story uses up to 20 scenes with 3 choices each", "familiarity": "approximate"}]},
     "clarify": [{"slot": "length", "value": "10 choices", "guessed": false}],
     "spec": {"spec": "game-spec/1",
      "theme": {"world": "A muddy medieval village and a far-off castle", "tone": "funny"},
      "goal": {"text": "Become the ruler in 10 choices or less", "target": "reach the crown ending", "measure": "ending reached"},
      "loop": {"verb": "choose", "sees": "a scene and up to three choices", "input": "tap", "feedback": "your gold, friends and fame change"},
      "end": {"win": "crowned", "lose": "out of choices", "ends_when": ["ending_reached", "choices_used_up"], "session_seconds": [60, 150]},
      "score": {"kind": "points", "measures": "ending reached and choices left", "direction": "higher"},
      "social": {"mode": "same_seed_async", "result": {"kind": "ending", "compare": "ending", "display": "{ending} in {choices} choices", "endings": ["Crowned", "Royal advisor", "Village hero", "Back to turnips"]}}},
     "types": [{"id": "choice_limit_quest", "name": "Choice-limited quest", "family": "story_choice", "score": 0.86}],
     "timings": {"total_ms": 34000}}
    """
}
#endif
