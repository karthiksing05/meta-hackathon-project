import SwiftUI

// Games in Facebook Search (docs/BUBBLES.md 7.3): matching, playable result rows, the strip of a
// person's games in People results, and "Make "<query>" with Muse" when nothing matches.

// MARK: - Matching

/// Games for a Search query, best match first. Matches title, rule, creator name, formula title,
/// category title (Adventure, Quiz night, Learn) and Group name, ignoring case and diacritics.
/// Every word in the query must match somewhere ("picnic dance-off" needs both). An empty query
/// returns no games.
@MainActor
func gamesMatching(query: String, in store: BubbleStore) -> [Bubble] {
    gamesMatching(query: query, bubbles: store.bubbles) { bubble in
        (bubble.group ?? store.resolveGroup(bubble.manifest.structure.groupID))?.name
    }
}

/// The pure core of `gamesMatching(query:in:)`: `groupName` looks up a Bubble's Group name.
func gamesMatching(query: String, bubbles: [Bubble], groupName: (Bubble) -> String?) -> [Bubble] {
    let phrase = SearchGamesMatch.fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
    guard !phrase.isEmpty else { return [] }
    let words = phrase.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    var scored: [(bubble: Bubble, rank: Int, index: Int)] = []
    for (index, bubble) in bubbles.enumerated() {
        let title = SearchGamesMatch.fold(bubble.title)
        var fields = [
            title,
            SearchGamesMatch.fold(bubble.rule),
            SearchGamesMatch.fold(bubble.creator.name),
            SearchGamesMatch.fold(bubble.formula.title),
        ]
        if bubble.category != .play {
            fields.append(SearchGamesMatch.fold(bubble.category.title))
        }
        if let group = groupName(bubble) {
            fields.append(SearchGamesMatch.fold(group))
        }
        let haystack = fields.joined(separator: " \u{1F} ")
        guard words.allSatisfy({ haystack.contains($0) }) else { continue }
        let rank: Int
        if title.hasPrefix(phrase) {
            rank = 0
        } else if title.contains(phrase) {
            rank = 1
        } else if words.allSatisfy({ title.contains($0) }) {
            rank = 2
        } else if fields[2].contains(phrase) {
            rank = 3
        } else {
            rank = 4
        }
        scored.append((bubble, rank, index))
    }
    return scored
        .sorted { lhs, rhs in lhs.rank != rhs.rank ? lhs.rank < rhs.rank : lhs.index < rhs.index }
        .map(\.bubble)
}

enum SearchGamesMatch {
    /// Lowercased, accents removed: "Café" and "cafe" match.
    static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil).lowercased()
    }

    /// Distinct friends of yours with a run on the Bubble.
    static func friendsPlayed(_ bubble: Bubble) -> Int {
        Set(bubble.scores.filter { $0.user.isFriend }.map(\.user.id)).count
    }

    /// Distinct players besides you.
    static func players(_ bubble: Bubble) -> Int {
        Set(bubble.scores.filter { !$0.user.isMe }.map(\.user.id)).count
    }
}

// MARK: - Result row

/// A playable game result: cover, title, creator, Group, "N friends played", Save and Play.
/// Tapping the row opens the Bubble page.
struct SearchGameRow: View {
    let bubble: Bubble
    let query: String
    let open: (Route) -> Void

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        HStack(spacing: 12) {
            Button {
                open(.bubble(bubble.id))
            } label: {
                HStack(spacing: 12) {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.5), lineWidth: 1)
                        )
                    VStack(alignment: .leading, spacing: 2) {
                        searchHighlighted(bubble.title, query: query)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                        socialLine
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(bubble.title), \(subtitle)")
            .accessibilityHint("Opens the game's page")
            Button {
                Haptics.light()
                bubbleStore.toggleSave(bubble, source: .search)
            } label: {
                Image(systemName: bubble.isSaved ? "bookmark.fill" : "bookmark")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(bubble.isSaved ? FBColor.savedPurple : FBColor.secondaryText)
                    .frame(width: 32, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(GroupsSearchCopy.saveA11y(bubble.title, bubble.isSaved))
            Button {
                Haptics.light()
                appStore.addRecentSearch(query)
                router.play(bubble.id)
            } label: {
                Label(GroupsSearchCopy.play, systemImage: "play.fill")
                    .labelStyle(.titleAndIcon)
            }
            .buttonStyle(.fb(.primary, expand: false, height: 36))
            .accessibilityLabel(GroupsSearchCopy.playA11y(bubble.title))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var subtitle: String {
        var parts: [String] = []
        if bubble.category != .play {
            parts.append(bubble.category.title)
        } else {
            parts.append(bubble.formula.title)
        }
        parts.append(GroupsSearchCopy.by(bubble.creator.isMe ? GroupsSearchCopy.you : bubble.creator.name))
        if let group = bubble.group ?? bubbleStore.resolveGroup(bubble.manifest.structure.groupID) {
            parts.append(GroupsSearchCopy.inGroup(group.name))
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var socialLine: some View {
        let friends = bubble.scores.filter { $0.user.isFriend }
        let faces = Array(Dictionary(friends.map { ($0.user.id, $0.user) }, uniquingKeysWith: { first, _ in first }).values)
            .sorted { $0.name < $1.name }
        if !faces.isEmpty {
            HStack(spacing: 6) {
                AvatarStack(users: faces, size: FBAvatarSize.micro, maxCount: 3)
                Text(GroupsSearchCopy.friendsPlayed(faces.count))
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(FBColor.accent)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(GroupsSearchCopy.friendsPlayed(faces.count))
        } else {
            let players = SearchGamesMatch.players(bubble)
            if players > 0 {
                Text(GroupsSearchCopy.playersCount(players))
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
    }
}

// MARK: - Make with Muse

/// `Make "<query>" with Muse`: opens Studio with the query as the prompt.
struct SearchMakeWithMuseRow: View {
    let query: String

    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        Button {
            Haptics.light()
            appStore.addRecentSearch(query)
            router.openStudio(StudioLaunch(prompt: query))
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: FBIconSize.regular, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(GroupBoardStyle.trophyGradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(GroupsSearchCopy.makeWithMuse(query))
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(GroupsSearchCopy.makeWithMuseDetail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(12)
            .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .accessibilityLabel(GroupsSearchCopy.makeWithMuse(query))
        .accessibilityHint(GroupsSearchCopy.makeWithMuseDetail)
    }
}

/// The Games filter with no matches: a short note and the Make-with-Muse row.
struct SearchGamesEmptyState: View {
    let query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            VStack(spacing: 6) {
                Image(systemName: "gamecontroller")
                    .font(.system(size: 34))
                    .foregroundStyle(FBColor.tertiaryText)
                Text(GroupsSearchCopy.noGames(query))
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 36)
            .padding(.bottom, 12)
            .padding(.horizontal, 24)
            SearchMakeWithMuseRow(query: query)
        }
    }
}

// MARK: - People strip

/// Under a person in People results: up to three covers of games they made ("Maya's games").
/// Draws nothing when they haven't made any.
struct SearchPersonGamesStrip: View {
    let user: User

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        let games = Array(bubbleStore.bubbles(by: user).prefix(3))
        if !games.isEmpty {
            HStack(spacing: 6) {
                HStack(spacing: -6) {
                    ForEach(games) { bubble in
                        BubbleCoverView(bubble: bubble, showsEmoji: true)
                            .frame(width: 26, height: 26)
                            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous)
                                    .strokeBorder(FBColor.surface, lineWidth: 1.5)
                            )
                    }
                }
                Text(label(games))
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(FBColor.accent)
                    .lineLimit(1)
            }
            .padding(.top, 2)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(GroupsSearchCopy.personGames(user.isMe ? GroupsSearchCopy.you : user.firstName)): \(games.map(\.title).joined(separator: ", "))")
        }
    }

    private func label(_ games: [Bubble]) -> String {
        let owner = user.isMe ? GroupsSearchCopy.yourGames : GroupsSearchCopy.personGames(user.firstName)
        return "\(owner) · \(games.map(\.title).joined(separator: ", "))"
    }
}
