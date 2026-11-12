import Foundation

/// Offline sample content, shown (and labeled) when the Scroll Games server can't be reached.
enum SGSample {
    static let me = SGUser(id: "u_me", name: "Bayan Mardon", isCreator: true)
    static let maya = SGUser(id: "u_maya", name: "Maya Santos", isCreator: true)
    static let theo = SGUser(id: "u_theo", name: "Theo Park", isCreator: true)
    static let users = [me, maya, theo]

    private static func theme(_ emoji: String, _ palette: String, _ mood: String) -> JSONValue {
        .object(["theme": .object([
            "emoji": .string(emoji), "palette": .string(palette), "mood": .string(mood),
        ])])
    }

    static let lisbon = SGGame(
        id: "g_sample_lisbon", title: "Lisbon Trip Trivia",
        description: "How well do you remember our trip?", creatorID: maya.id,
        manifest: theme("🌍", "sunset", "playful"), stats: SGGameStats(plays: 128, best: 840))
    static let snacks = SGGame(
        id: "g_sample_snacks", title: "Guess the Snack",
        description: "Photo quiz from the potluck", creatorID: theo.id,
        manifest: theme("🍜", "candy", "chill"), stats: SGGameStats(plays: 54, best: 610))
    static let hike = SGGame(
        id: "g_sample_hike", title: "Trailhead Memory Run",
        description: "Eight rounds, one very muddy weekend", creatorID: maya.id,
        manifest: theme("🥾", "forest", "energetic"), stats: SGGameStats(plays: 9, best: 420))

    static let feed: [SGFeedItem] = [
        SGFeedItem(
            id: "f_sample_c1", type: "challenge", actor: maya, game: lisbon,
            challenge: SGChallenge(id: "c_sample_1", gameID: lisbon.id, seed: 840, fromUserID: maya.id, score: 840),
            text: "Maya scored 840 on Lisbon Trip Trivia. Beat them?"),
        SGFeedItem(
            id: "f_sample_c2", type: "challenge", actor: theo, game: snacks,
            challenge: SGChallenge(id: "c_sample_2", gameID: snacks.id, seed: 610, fromUserID: theo.id, score: 610),
            text: "Theo scored 610 on Guess the Snack. Beat them?"),
        SGFeedItem(id: "f_sample_g1", type: "game", actor: maya, game: lisbon),
        SGFeedItem(
            id: "f_sample_s1", type: "score", actor: theo, game: lisbon,
            play: SGPlay(score: 720), text: "Theo scored 720 on Lisbon Trip Trivia"),
        SGFeedItem(id: "f_sample_g2", type: "game", actor: theo, game: snacks),
        SGFeedItem(id: "f_sample_g3", type: "game", actor: maya, game: hike),
    ]

    static let groups = [
        SGGroup(id: "grp_sample_trip", name: "Lisbon Trip", mediaIDs: ["m_s1", "m_s2", "m_s3", "m_s4"]),
        SGGroup(id: "grp_sample_potluck", name: "Potluck Crew", mediaIDs: ["m_s5", "m_s6", "m_s7", "m_s8"]),
    ]

    static let media: [SGMedia] = [
        ("m_s1", "Sunset over the Tagus", "grp_sample_trip"),
        ("m_s2", "Tram 28 uphill", "grp_sample_trip"),
        ("m_s3", "Pastéis de nata at midnight", "grp_sample_trip"),
        ("m_s4", "Group photo at Sintra", "grp_sample_trip"),
        ("m_s5", "Dumpling table", "grp_sample_potluck"),
        ("m_s6", "Mystery casserole", "grp_sample_potluck"),
        ("m_s7", "Dessert lineup", "grp_sample_potluck"),
        ("m_s8", "Spice rack", "grp_sample_potluck"),
    ].map { id, caption, group in
        SGMedia(id: id, url: "https://picsum.photos/seed/sg-\(id)/300/300", caption: caption, groupID: group)
    }

    static func brief(for prompt: String) -> SGBriefResponse {
        let title = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        return SGBriefResponse(
            brief: .object([
                "intent": .string(title.isEmpty ? "A quiz about our trip" : title),
                "audience": .string("friends"),
                "title_idea": .string(title.isEmpty ? "Trip Trivia" : String(title.prefix(40))),
                "template": .string("quiz"),
                "level": .string("remix"),
                "mood": .string("playful"),
                "energy": .number(3),
                "competition": .string("versus"),
                "limits": .object(["rounds": .number(8), "duration_s": .number(90)]),
                "glue_ideas": .array([.string("Final round is worth double")]),
            ]),
            ms: nil, cached: false, source: "offline")
    }
}
