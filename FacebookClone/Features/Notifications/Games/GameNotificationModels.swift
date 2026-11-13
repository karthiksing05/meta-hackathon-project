import Foundation

/// Server-authored notifications. Eligibility, text, read state and recommendation caps live
/// on Max's backend; the client never infers them from a score or feed page.
struct RemoteGameNotification: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let kind: String
    let title: String
    let body: String
    let gameID: String?
    let groupID: String?
    let challengeID: String?
    let seriesID: String?
    var roundID: String? = nil
    var sessionID: String? = nil
    let createdAt: Date
    var readAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, kind, title, body, createdAt, readAt
        case gameID = "gameId", groupID = "groupId", challengeID = "challengeId", seriesID = "seriesId"
        case roundID = "roundId", sessionID = "sessionId"
    }

    var isRead: Bool { readAt != nil }

    var symbol: String {
        switch kind {
        case "group_game": return "person.3.fill"
        case "friend_challenge": return "flag.checkered"
        case "leaderboard_lost": return "trophy.fill"
        case "viral_match": return "sparkles"
        case "session_invite": return "person.3.sequence.fill"
        case "round_started", "round_played": return "flag.2.crossed.fill"
        default: return "gamecontroller.fill"
        }
    }
}

struct RemoteGameNotificationPage: Decodable, Sendable {
    let items: [RemoteGameNotification]
    let nextCursor: String?
    let unreadCount: Int
}

protocol GameNotificationsAPI: Sendable {
    func gameNotifications(cursor: String?) async throws -> RemoteGameNotificationPage
    func setGameNotificationRead(id: String, read: Bool) async throws
    func markAllGameNotificationsRead() async throws
    func registerGamePushDevice(installationID: String, token: String, environment: String) async throws
    func unregisterGamePushDevice(installationID: String) async throws
    func shareGameToGroup(gameID: String, groupID: String, eventID: String) async throws
}

/// Value-only routing keeps all four kinds testable without UI or a notification payload.
enum GameNotificationDestination: Equatable, Sendable {
    case challenges, leaderboard(String), game(String), group(String), round(String), session(String), inbox
}

extension RemoteGameNotification {
    var destination: GameNotificationDestination {
        switch kind {
        case "friend_challenge": return .challenges
        case "round_started", "round_played":
            if let id = roundID { return .round(id) }
            return gameID.map(GameNotificationDestination.game) ?? .inbox
        case "session_invite":
            if let id = sessionID { return .session(id) }
            return groupID.map(GameNotificationDestination.group) ?? .inbox
        case "leaderboard_lost": return gameID.map(GameNotificationDestination.leaderboard) ?? .inbox
        case "group_game":
            if let id = gameID { return .game(id) }
            return groupID.map(GameNotificationDestination.group) ?? .inbox
        default: return gameID.map(GameNotificationDestination.game) ?? .inbox
        }
    }
}
