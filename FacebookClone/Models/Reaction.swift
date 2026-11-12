import Foundation

enum ReactionType: String, CaseIterable, Identifiable, Hashable {
    case like
    case love
    case care
    case haha
    case wow
    case sad
    case angry

    var id: String { rawValue }

    var title: String {
        switch self {
        case .like: return "Like"
        case .love: return "Love"
        case .care: return "Care"
        case .haha: return "Haha"
        case .wow: return "Wow"
        case .sad: return "Sad"
        case .angry: return "Angry"
        }
    }

    var emoji: String {
        switch self {
        case .like: return "👍"
        case .love: return "❤️"
        case .care: return "🥰"
        case .haha: return "😆"
        case .wow: return "😮"
        case .sad: return "😢"
        case .angry: return "😡"
        }
    }

    var sortIndex: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    /// A random reaction weighted the way real feeds skew (mostly Like and Love).
    static func weightedRandom() -> ReactionType {
        let roll = Int.random(in: 0..<100)
        switch roll {
        case 0..<55: return .like
        case 55..<80: return .love
        case 80..<87: return .haha
        case 87..<93: return .care
        case 93..<96: return .wow
        case 96..<99: return .sad
        default: return .angry
        }
    }
}

/// Shared math for posts and comments. `counts` never includes the signed-in user's reaction.
enum ReactionMath {
    static func total(_ counts: [ReactionType: Int], mine: ReactionType?) -> Int {
        counts.values.reduce(0, +) + (mine == nil ? 0 : 1)
    }

    /// The most common reaction types, most popular first.
    static func top(_ counts: [ReactionType: Int], mine: ReactionType?, limit: Int = 3) -> [ReactionType] {
        var merged = counts
        if let mine {
            merged[mine, default: 0] += 1
        }
        let sorted = merged
            .filter { $0.value > 0 }
            .sorted { lhs, rhs in
                if lhs.value == rhs.value {
                    return lhs.key.sortIndex < rhs.key.sortIndex
                }
                return lhs.value > rhs.value
            }
        return sorted.prefix(limit).map { $0.key }
    }
}
