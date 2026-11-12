import Observation
import SwiftUI

enum SGFeedState: Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Feed, users and follow state for the Games tab. Falls back to labeled sample data when the server is down.
@Observable
@MainActor
final class SGStore {
    var items: [SGFeedItem] = []
    var state: SGFeedState = .loading
    /// True when the content on screen is sample data because the server couldn't be reached.
    var isOffline = false
    var users: [String: SGUser] = [:]
    var followedCreatorIDs: Set<String> = []
    var daily: SGDaily?

    private let api = ScrollGamesAPI.shared

    var me: SGUser { users[SGConfig.userID] ?? SGSample.me }

    /// Challenges addressed to me, for the "Challenges for you" strip.
    var challenges: [SGFeedItem] { items.filter { $0.kind == .challenge } }

    /// Everything that isn't a challenge or the pinned daily, in feed order.
    var feedItems: [SGFeedItem] { items.filter { $0.kind != .challenge && $0.kind != .daily } }

    func refresh() async {
        if items.isEmpty { state = .loading }
        do {
            async let feed = api.feed()
            async let users = api.users()
            async let today = api.daily()
            let loaded = try await feed
            let people = (try? await users) ?? []
            daily = try? await today
            isOffline = false
            apply(feed: loaded, users: people)
            state = .loaded
        } catch is CancellationError {
            return
        } catch {
            isOffline = true
            daily = SGSample.daily
            apply(feed: SGSample.feed, users: SGSample.users)
            state = items.isEmpty ? .failed(error.localizedDescription) : .loaded
        }
    }

    private func apply(feed: [SGFeedItem], users people: [SGUser]) {
        items = feed
        var table = Dictionary(uniqueKeysWithValues: SGSample.users.map { ($0.id, $0) })
        for user in people { table[user.id] = user }
        for item in feed {
            if let actor = item.actor { table[actor.id] = actor }
        }
        users = table
        if followedCreatorIDs.isEmpty, let me = table[SGConfig.userID] {
            followedCreatorIDs = Set(me.follows)
        }
    }

    func user(id: String) -> SGUser {
        users[id] ?? SGUser(id: id, name: id)
    }

    func creator(of game: SGGame, fallback: SGUser?) -> SGUser {
        users[game.creatorID] ?? fallback ?? user(id: game.creatorID)
    }

    func games(by creatorID: String) -> [SGGame] {
        var seen = Set<String>()
        return items.compactMap(\.game).filter { $0.creatorID == creatorID && seen.insert($0.id).inserted }
    }

    func isFollowing(_ id: String) -> Bool { followedCreatorIDs.contains(id) }

    func toggleFollow(_ id: String) {
        if followedCreatorIDs.contains(id) {
            followedCreatorIDs.remove(id)
        } else {
            followedCreatorIDs.insert(id)
        }
    }

    /// Sends a report for a game; returns false when the server couldn't be reached.
    func report(game: SGGame, reason: SGReportReason) async -> Bool {
        do {
            try await api.reportGame(gameID: game.id, reason: reason.apiValue)
            return true
        } catch {
            return false
        }
    }

    /// Puts a freshly published game at the top of the feed.
    func insertPublished(game: SGGame, feedItem: SGFeedItem?) {
        let item = feedItem ?? SGFeedItem(id: "f_\(game.id)", type: "game", actor: me, game: game)
        items.removeAll { $0.id == item.id }
        items.insert(item, at: 0)
        if state != .loaded { state = .loaded }
    }
}

/// Builds the app's `User` model from a server user so `AvatarView` can draw it.
extension SGUser {
    var appUser: User {
        let parts = name.split(separator: " ", maxSplits: 1).map(String.init)
        return User(
            id: id,
            firstName: parts.first ?? name,
            lastName: parts.count > 1 ? parts[1] : "",
            avatarURL: avatarURL.flatMap(URL.init(string:))
        )
    }
}

/// Gradient colors for a game's theme palette.
enum SGPalette {
    private static let gradients: [[Color]] = [
        [Color(hex: 0xFF8008), Color(hex: 0xFFC837)],
        [Color(hex: 0x4E54C8), Color(hex: 0x8F94FB)],
        [Color(hex: 0x11998E), Color(hex: 0x38EF7D)],
        [Color(hex: 0xFC466B), Color(hex: 0x3F5EFB)],
        [Color(hex: 0xF5576C), Color(hex: 0xF093FB)],
        [Color(hex: 0x0866FF), Color(hex: 0x00C6FF)],
    ]

    private static let named: [String: Int] = [
        "sunset": 0, "midnight": 1, "forest": 2, "neon": 3, "candy": 4, "ocean": 5,
    ]

    static func colors(for palette: String) -> [Color] {
        let index = named[palette.lowercased()] ?? Int(SeededGenerator.stableHash(palette) % UInt64(gradients.count))
        return gradients[index]
    }

    static func gradient(for palette: String) -> LinearGradient {
        LinearGradient(colors: colors(for: palette), startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}
