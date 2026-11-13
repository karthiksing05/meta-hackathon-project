import Foundation

/// A person's `avatarUrl` from the server, as a picture the app can draw.
enum PersonAvatarURL {
    /// The URL to load, or nil to keep the cartoon fallback. `RemoteImage` decodes with `UIImage`,
    /// which can't draw SVG, so a DiceBear SVG becomes the same picture as PNG (`/svg` → `/png`);
    /// any other SVG is left out.
    static func displayable(_ string: String?) -> URL? {
        guard let text = string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
              var parts = URLComponents(string: text),
              let scheme = parts.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        let host = parts.host?.lowercased() ?? ""
        if host.hasSuffix("dicebear.com") {
            if parts.path.hasSuffix("/svg") {
                parts.path = String(parts.path.dropLast(4)) + "/png"
            } else if parts.path.hasSuffix(".svg") {
                parts.path = String(parts.path.dropLast(4)) + ".png"
            }
        } else if parts.path.lowercased().hasSuffix(".svg") {
            return nil
        }
        return parts.url
    }

    /// The server's default for someone with no picture of their own: the DiceBear cartoon seeded by
    /// their username (`cartoonAvatar` in backend/internal/api/fbsocial.go).
    static func cartoon(username: String) -> URL? {
        guard !username.isEmpty else { return nil }
        let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        let seed = username.addingPercentEncoding(withAllowedCharacters: safe) ?? username
        return URL(string: "https://api.dicebear.com/9.x/notionists/png?size=256&backgroundColor=c0aede,b6e3f4,d1d4f9&seed=\(seed)")
    }

    /// A profile's picture: the one they chose, else their cartoon.
    static func forProfile(_ profile: RemoteProfile) -> URL? {
        displayable(profile.avatarURL) ?? cartoon(username: profile.username)
    }
}

/// Fills in pictures for server people the app met with only an id and a name (board rows, rounds,
/// challenges, Group boards). Everyone seen within a moment goes into one
/// `GET /v1/fb/people?ids=` call, which answers each account's own picture or its cartoon. Until it
/// lands (or if it fails) `AvatarView` shows the initials. Each id is asked once per launch.
///
/// Call from the main thread, like `BubbleStore`.
final class ServerAvatarLookup {
    static let shared = ServerAvatarLookup()

    private var waiting: [String: [User]] = [:]
    private var asked: Set<String> = []
    private var isScheduled = false
    private static let batchDelay: UInt64 = 250_000_000
    private static let batchSize = 100

    func fill(_ user: User) {
        guard user.avatarURL == nil, user.avatarData == nil, !user.isMe,
              GameIDMap.isServerID(user.id), !asked.contains(user.id) else { return }
        if waiting[user.id]?.contains(where: { $0 === user }) == true { return }
        waiting[user.id, default: []].append(user)
        guard !isScheduled else { return }
        isScheduled = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.batchDelay)
            await self?.flush()
        }
    }

    @MainActor
    private func flush() async {
        isScheduled = false
        let batch = waiting
        waiting = [:]
        let ids = Array(batch.keys)
        asked.formUnion(ids)
        for start in stride(from: 0, to: ids.count, by: Self.batchSize) {
            let slice = Array(ids[start..<min(start + Self.batchSize, ids.count)])
            guard let people = try? await FacebookAPILive.shared.people(ids: slice) else { continue }
            for person in people {
                guard let url = PersonAvatarURL.displayable(person.avatarUrl) else { continue }
                for user in batch[person.id] ?? [] where user.avatarURL == nil {
                    user.avatarURL = url
                }
            }
        }
    }
}
