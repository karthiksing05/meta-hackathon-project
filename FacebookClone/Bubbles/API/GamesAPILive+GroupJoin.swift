import Foundation

// Group join policies and the profile fields people set themselves (backend/README.md, "Groups";
// backend/internal/api/groupjoin.go).
//
//     let outcome = try await api.joinGroup(id: group.id)          // .joined or .requested
//     try await api.addGroupMember(groupID: group.id, userID: id)  // add a friend, or approve an ask
//     let asks = try await api.groupJoinRequests(groupID: group.id) // the owner only
//     let group = try await api.updateGroup(id: id, GroupSettingsChange(joinPolicy: "request"))
//     let me = try await api.updateMyProfile(ProfileChange(bio: "Hi"))

/// What `PUT /v1/groups/{id}/members/me` did.
enum GroupJoinOutcome: Sendable, Equatable {
    /// An open Group: you're in.
    case joined
    /// A request Group: the owner has your ask.
    case requested
}

/// A Group's settings to change (`PATCH /v1/groups/{id}`). Nil fields stay as they are.
struct GroupSettingsChange: Sendable, Equatable {
    var joinPolicy: String?
    var recruiting: Bool?
    var coverColor: String?

    var json: [String: Any] {
        var out: [String: Any] = [:]
        if let joinPolicy { out["joinPolicy"] = joinPolicy }
        if let recruiting { out["recruiting"] = recruiting }
        if let coverColor { out["coverColor"] = coverColor }
        return out
    }
}

/// My profile fields to change (`PATCH /v1/me/profile`). Nil fields stay as they are; an empty
/// `avatarURL` goes back to the cartoon from the username.
struct ProfileChange: Sendable, Equatable {
    var displayName: String?
    var bio: String?
    var avatarURL: String?
    var coverColor: String?

    var json: [String: Any] {
        var out: [String: Any] = [:]
        if let displayName { out["displayName"] = displayName }
        if let bio { out["bio"] = bio }
        if let avatarURL { out["avatarUrl"] = avatarURL }
        if let coverColor { out["coverColor"] = coverColor }
        return out
    }
}

private struct GroupJoinReply: Decodable {
    var isMember: Bool?
    var requested: Bool?
}

extension GamesAPILive {
    func joinGroup(id: String) async throws -> GroupJoinOutcome {
        let reply: GroupJoinReply = try decodeReply(try await authedJSON("PUT", "v1/groups/\(id)/members/me"))
        return reply.requested == true && reply.isMember != true ? .requested : .joined
    }

    func addGroupMember(groupID: String, userID: String) async throws {
        _ = try await authedJSON("PUT", "v1/groups/\(groupID)/members/\(userID)")
    }

    func groupJoinRequests(groupID: String) async throws -> [RemoteProfile] {
        (try decodeReply(try await authedJSON("GET", "v1/groups/\(groupID)/requests")) as RemoteList<RemoteProfile>).items
    }

    func updateGroup(id: String, _ change: GroupSettingsChange) async throws -> RemoteGroup {
        let body = try JSONSerialization.data(withJSONObject: change.json)
        return try decodeReply(try await authedJSON("PATCH", "v1/groups/\(id)", body: body))
    }

    func updateMyProfile(_ change: ProfileChange) async throws -> RemoteUser {
        let body = try JSONSerialization.data(withJSONObject: change.json)
        return try decodeReply(try await authedJSON("PATCH", "v1/me/profile", body: body))
    }
}

extension GamesAPIError {
    /// The server's 403 for joining an invite-only Group (`code: "invite_only"`).
    var isInviteOnly: Bool {
        if case .server(let status, let message) = self, status == 403 {
            return message.localizedCaseInsensitiveContains("invite only")
        }
        return false
    }
}
