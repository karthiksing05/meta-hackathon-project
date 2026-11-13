import Foundation

/// A Group's Blend (`groupBlend` in game-recs.js): games recommended to everyone in the Group,
/// a Blend game spec Muse Studio can make for all of them, and taste twins to add as friends.
///
/// - Each game is scored by the geometric mean of the members' predicted enjoyment (the chance
///   everyone enjoys it, if members are independent), with a misery floor.
/// - Fairness is only ever a plus: similar skill on the game's formula earns a bonus that is
///   exactly 0 once skills diverge, and members the Blend has served least get their picks boosted.
/// - The demo cast's taste profiles are synthetic (deterministic from their id, steered by their
///   bio). Yours comes from what you play.
struct GroupBlend: Decodable {
    struct Pick: Decodable, Identifiable {
        let gameID: String
        /// "Everyone's pick" or "For Maya & you".
        let label: String
        let why: String
        /// Geometric mean of the members' predicted enjoyment.
        let everyone: Double
        let minEnjoy: Double
        let skillPlus: Double?

        var id: String { gameID }
    }

    /// The Blend game, in the shape of `BubbleBrief`, plus a prompt Studio takes as-is.
    struct Spec: Decodable {
        let formula: String
        let look: String
        let mood: [String]
        let energy: String
        let competition: String
        let why: String
        let prompt: String
        let evenlyMatched: Bool?
    }

    /// Someone in the Group with a taste like yours whom you aren't friends with yet.
    struct Twin: Decodable, Identifiable {
        let userID: String
        let name: String
        let similarity: Double
        let why: String
        let evenlyMatched: Bool?

        var id: String { userID }
    }

    let picks: [Pick]
    let spec: Spec?
    /// Mean pairwise taste similarity, 0...1.
    let cohesion: Double
    let twins: [Twin]
}

/// What `groupBlend` in game-recs.js takes.
struct GroupBlendInput: Encodable {
    struct GroupInfo: Encodable {
        let id: String
        let name: String
    }

    struct Member: Encodable {
        struct Skill: Encodable {
            let overall: Double
            /// Formula raw value → 0...1. Missing formulas use `overall`.
            let byFormula: [String: Double]
        }

        struct Hints: Encodable {
            let bio: String?
            let themes: [String]
        }

        let id: String
        let name: String
        let isMe: Bool
        let isFriend: Bool
        let skill: Skill
        let hints: Hints?
    }

    let group: GroupInfo
    let members: [Member]
    let summaries: [GameRecSummary]
    let feed: [String]
    let count: Int
    let day: Int
}

extension BubbleStore {
    /// The Blend for `group`, or nil when the recommender is off or the Group has fewer than two
    /// people we can see. Members are you plus the Group's member sample; for New in SF, the
    /// whole demo cast.
    func groupBlend(for group: FBGroup, count: Int = 8) -> GroupBlend? {
        let members = blendMembers(for: group)
        guard members.count >= 2 else { return nil }
        let input = GroupBlendInput(
            group: .init(id: group.id, name: group.name),
            members: members,
            summaries: bubbles.map(GameRecSummary.init),
            feed: [],
            count: count,
            day: GameRecommender.today()
        )
        return GameRecommender.shared.groupBlend(input)
    }

    private func blendMembers(for group: FBGroup) -> [GroupBlendInput.Member] {
        let me = appStore.me
        var members = [GroupBlendInput.Member(
            id: me.id, name: me.firstName, isMe: true, isFriend: false, skill: mySkill(), hints: nil
        )]
        var seen: Set<String> = [me.id]
        if group.id == BubbleDemo.groupID, let roster = BubbleRoster.bundled {
            for person in roster.people where seen.insert(person.id).inserted {
                let user = resolvePerson(person.id)
                members.append(.init(
                    id: person.id,
                    name: person.firstName,
                    isMe: false,
                    isFriend: user.isFriend,
                    skill: .init(overall: BubbleRoster.skill(of: person.id), byFormula: [:]),
                    hints: .init(bio: person.intro, themes: [person.neighborhood])
                ))
            }
        }
        for user in group.memberSample where seen.insert(user.id).inserted {
            members.append(.init(
                id: user.id,
                name: user.firstName,
                isMe: false,
                isFriend: user.isFriend,
                skill: .init(overall: BubbleRoster.skill(of: user.id), byFormula: [:]),
                hints: user.bio.isEmpty ? nil : .init(bio: user.bio, themes: [])
            ))
        }
        return Array(members.prefix(12))
    }

    /// Your skill per formula: where your best scores land on each game's board, averaged.
    private func mySkill() -> GroupBlendInput.Member.Skill {
        let me = appStore.me
        var totals: [String: (sum: Double, count: Int)] = [:]
        for bubble in bubbles {
            guard let mine = bestScore(of: me, in: bubble) else { continue }
            let others = leaderboard(for: bubble, scope: .everyone).filter { !$0.user.isMe }
            guard !others.isEmpty else { continue }
            let below = others.filter { $0.score < mine.score }.count
            let key = bubble.formula.rawValue
            let current = totals[key] ?? (0, 0)
            totals[key] = (current.sum + Double(below) / Double(others.count), current.count + 1)
        }
        var byFormula: [String: Double] = [:]
        for (key, value) in totals {
            byFormula[key] = value.sum / Double(value.count)
        }
        let overall = byFormula.isEmpty ? 0.5 : byFormula.values.reduce(0, +) / Double(byFormula.count)
        return .init(overall: overall, byFormula: byFormula)
    }
}
