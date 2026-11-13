import SwiftUI

// Slot views for the "groups-search" feature (docs/BUBBLES.md 7.3). Owner: groups-search.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift.

/// Top of the Group's Games tab: Daily Bubble, weekly leaderboard, 'Challenge the Group', game night entry.
struct GroupsSearchGamesHub: View {
    let group: FBGroup

    var body: some View {
        GroupGamesHubView(group: group)
    }
}

/// Bottom of the Games tab: every game made for the Group.
struct GroupsSearchGamesList: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        let games = bubbleStore.worldBubbles(in: group)
        let members = Set(GroupGamesStore.shared.memberIDs(of: group, in: bubbleStore)).union([bubbleStore.appStore.me.id])
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: GroupsSearchCopy.groupGamesTitle, subtitle: games.isEmpty ? nil : GroupsSearchCopy.groupGamesSubtitle(games.count))
            if games.isEmpty {
                emptyState
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                    ForEach(games) { bubble in
                        NavigationLink(value: Route.bubble(bubble.id)) {
                            VStack(alignment: .leading, spacing: 4) {
                                BubbleCard(bubble: bubble)
                                Label(GroupsSearchCopy.membersPlayed(playedCount(bubble, members: members)), systemImage: "person.2.fill")
                                    .font(.fbCaption)
                                    .foregroundStyle(FBColor.secondaryText)
                                    .lineLimit(1)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private func playedCount(_ bubble: Bubble, members: Set<String>) -> Int {
        Set(bubble.scores.map(\.user.id)).intersection(members).count
    }

    /// The Group leaderboards card at the top of the tab already offers "Make one" or "Join the
    /// Group" when there are no games, so this stays a quiet line instead of a second button.
    private var emptyState: some View {
        Text(GroupsSearchCopy.noGamesDetail)
            .font(.fbMeta)
            .foregroundStyle(FBColor.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A small weekly-leaderboard teaser in the Featured tab's Bubbles block.
struct GroupsSearchFeaturedTeaser: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let standings = GroupGamesStore.shared.weeklyStandings(group: group, in: bubbleStore)
        if let leader = standings.first {
            let text = teaserText(leader: leader, standings: standings)
            Button {
                Haptics.light()
                router.push(.bubbleFeature(GroupsSearchScreens.leaderboardRoute(for: group.id)))
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "trophy.fill")
                        .font(.system(size: FBIconSize.small, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(GameColor.accentGradient, in: Circle())
                    AvatarView(user: leader.user, size: FBAvatarSize.tiny)
                    Text(text)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                        .foregroundStyle(FBColor.secondaryText)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(FBColor.surface)
                .overlay(alignment: .top) { HairlineDivider() }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(text). \(GroupsSearchCopy.seeFullBoard)")
        }
    }

    private func teaserText(leader: GroupGamesStore.Standing, standings: [GroupGamesStore.Standing]) -> String {
        if leader.user.isMe {
            return GroupsSearchCopy.teaserYouLead(standings.dropFirst().first?.user.firstName)
        }
        let mine = standings.first { $0.user.isMe }?.rank
        return GroupsSearchCopy.teaser(leader: leader.user.firstName, you: mine)
    }
}
