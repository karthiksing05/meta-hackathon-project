import SwiftUI
import UIKit

// MARK: - Environment

private struct PostPushKey: EnvironmentKey {
    static var defaultValue: ((Route) -> Void)? { nil }
}

private struct PostOwningTabKey: EnvironmentKey {
    static var defaultValue: AppTab? { nil }
}

extension EnvironmentValues {
    /// Pushes a route onto the navigation stack that shows the post. Sheets with their own
    /// `NavigationStack` (comments, reactions) set it; elsewhere posts fall back to `router.push`.
    var postPush: ((Route) -> Void)? {
        get { self[PostPushKey.self] }
        set { self[PostPushKey.self] = newValue }
    }

    /// The tab whose stack shows the post. Optional: when it is not set, a feed video
    /// remembers the tab that was selected when it appeared and pauses on other tabs.
    var postOwningTab: AppTab? {
        get { self[PostOwningTabKey.self] }
        set { self[PostOwningTabKey.self] = newValue }
    }
}

// MARK: - In-app links

/// Names, groups, hashtags and mentions inside post text are links with this private
/// scheme. `PostCard` routes them in-app; every other URL opens normally.
enum PostLink {
    enum Kind: String {
        case profile
        case group
        case hashtag
        case mention
    }

    static let scheme = "fbpost"

    static func profile(_ user: User) -> URL? { make(.profile, user.id) }
    static func group(_ group: FBGroup) -> URL? { make(.group, group.id) }
    static func hashtag(_ tag: String) -> URL? { make(.hashtag, tag) }
    static func mention(_ name: String) -> URL? { make(.mention, name) }

    static func parse(_ url: URL) -> (kind: Kind, value: String)? {
        guard url.scheme == scheme,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = components.host,
              let kind = Kind(rawValue: host),
              let value = components.queryItems?.first(where: { $0.name == "v" })?.value,
              !value.isEmpty else { return nil }
        return (kind, value)
    }

    private static func make(_ kind: Kind, _ value: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = kind.rawValue
        components.queryItems = [URLQueryItem(name: "v", value: value)]
        return components.url
    }
}

/// Builds post text with #hashtags and @mentions in the accent color.
enum PostRichText {
    private static let pattern = try? NSRegularExpression(pattern: "[#@][\\p{L}\\p{N}_]+", options: [])

    /// When `linked` is true the tags are tappable `PostLink`s (links take the view's tint).
    static func make(_ text: String, linked: Bool = true) -> AttributedString {
        guard let pattern, !text.isEmpty else { return AttributedString(text) }
        let nsText = text as NSString
        let matches = pattern.matches(in: text, options: [], range: NSRange(location: 0, length: nsText.length))
        guard !matches.isEmpty else { return AttributedString(text) }

        var result = AttributedString()
        var cursor = 0
        for match in matches {
            let range = match.range
            if range.location > cursor {
                let plain = nsText.substring(with: NSRange(location: cursor, length: range.location - cursor))
                result.append(AttributedString(plain))
            }
            let token = nsText.substring(with: range)
            var tag = AttributedString(token)
            tag.foregroundColor = FBColor.accent
            if linked {
                let value = String(token.dropFirst())
                tag.link = token.hasPrefix("#") ? PostLink.hashtag(value) : PostLink.mention(value)
            }
            result.append(tag)
            cursor = range.location + range.length
        }
        if cursor < nsText.length {
            result.append(AttributedString(nsText.substring(from: cursor)))
        }
        return result
    }
}

// MARK: - Store helpers

extension AppStore {
    /// The in-app destination for a `PostLink`, preferring people and groups the post itself shows.
    func postRoute(for url: URL, in post: Post?) -> Route? {
        guard let link = PostLink.parse(url) else { return nil }
        switch link.kind {
        case .profile:
            var known: [User] = []
            if let post {
                known.append(post.author)
                if let owner = post.timelineOwner { known.append(owner) }
                known.append(contentsOf: post.taggedUsers)
                if let shared = post.sharedPost { known.append(shared.author) }
            }
            if let person = known.first(where: { $0.id == link.value }) ?? user(id: link.value) {
                return .profile(person)
            }
            return nil
        case .group:
            if let group = post?.group, group.id == link.value {
                return .group(group)
            }
            if let found = group(id: link.value) {
                return .group(found)
            }
            return nil
        case .hashtag:
            return .search("#" + link.value)
        case .mention:
            if let person = postUser(matchingMention: link.value) {
                return .profile(person)
            }
            return .search(link.value)
        }
    }

    /// "@MariaLopez" or "@Maria" to a person or Page, if one matches.
    func postUser(matchingMention mention: String) -> User? {
        let key = mention.lowercased()
        let everyone = [me] + people + pages
        if let exact = everyone.first(where: { $0.name.replacingOccurrences(of: " ", with: "").lowercased() == key }) {
            return exact
        }
        return everyone.first { $0.firstName.lowercased() == key }
    }

    func postShareURL(for post: Post) -> URL? {
        URL(string: "https://www.facebook.com/\(post.author.id)/posts/\(post.id)")
    }

    /// "Copy link": puts the post's URL on the pasteboard and confirms with a toast.
    func postCopyLink(_ post: Post) {
        UIPasteboard.general.string = postShareURL(for: post)?.absoluteString
        showToast("Link copied to clipboard", symbol: "link")
    }
}
