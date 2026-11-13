import SwiftUI

// The Group's weekly games leaderboard (docs/BUBBLES.md 7.3): the leader's trophy moment,
// "Most improved", and Add friend on every row of someone you don't know yet. A new view on
// purpose: BubbleBoardView (one Bubble's board) is claimed by another teammate.

/// Facebook blue to purple, for the trophy and the Most improved chip.
enum GroupBoardStyle {
    static let improvedTint = FBColor.savedPurple
}

/// Actions shared by the board card, the full board and the debug launch.
@MainActor
enum GroupWeeklyBoardActions {
    /// Sends a friend request from the leaderboard and reports the collaboration moment.
    static func addFriend(_ user: User, group: FBGroup, appStore: AppStore, bubbleStore: BubbleStore) {
        guard !user.isMe, user.friendship == .none || user.friendship == .requestReceived else { return }
        appStore.sendRequest(to: user)
        let bubbleID = bubbleStore.worldDailyBubble(for: group)?.id ?? bubbleStore.worldBubbles(in: group).first?.id ?? ""
        BubbleSocialSignals.post(.addFriendFromGame, bubbleID: bubbleID, with: [user.id])
        appStore.showToast(GroupsSearchCopy.requestSentToast(user.firstName), symbol: "person.badge.plus")
    }
}

// MARK: - Full screen

/// `FB_OPEN=feature:groups-search/leaderboard/<groupID>`: the whole weekly board.
struct GroupWeeklyBoardView: View {
    let groupID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        Group {
            if let group = appStore.group(id: groupID) ?? bubbleStore.resolveGroup(groupID) {
                ScrollView {
                    VStack(spacing: 0) {
                        GroupWeeklyBoardCard(group: group, limit: nil, showsSeeAll: false)
                        FeedSeparator()
                        GroupsSearchGamesList(group: group)
                    }
                }
                .background(FBColor.background)
                .navigationTitle(group.name)
            } else {
                ContentUnavailableView(GroupsSearchCopy.groupMissing, systemImage: "trophy", description: Text(GroupsSearchCopy.groupMissingDetail))
                    .navigationTitle(GroupsSearchCopy.weeklyTitle)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Card

/// The weekly board as a card: trophy leader, Most improved, ranked rows, your row.
struct GroupWeeklyBoardCard: View {
    let group: FBGroup
    /// Rows to show after the leader; nil shows everyone.
    var limit: Int? = 4
    var showsSeeAll = true

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let standings = GroupGamesStore.shared.weeklyStandings(group: group, in: bubbleStore)
        VStack(alignment: .leading, spacing: 12) {
            header
            if let leader = standings.first {
                GroupTrophyLeaderRow(group: group, standing: leader)
                if let improved = standings.first(where: \.isMostImproved) {
                    GroupMostImprovedRow(group: group, standing: improved)
                }
                rows(standings)
                footer(standings)
            } else {
                emptyState
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(GroupsSearchCopy.weeklyTitle)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Text(GroupsSearchCopy.weeklySubtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
            Image(systemName: "trophy.fill")
                .font(.system(size: FBIconSize.large, weight: .semibold))
                .foregroundStyle(GameColor.accentGradient)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func rows(_ standings: [GroupGamesStore.Standing]) -> some View {
        let rest = Array(standings.dropFirst())
        let shown = limit.map { Array(rest.prefix($0)) } ?? rest
        let mine = standings.first { $0.user.isMe }
        VStack(spacing: 0) {
            ForEach(shown) { standing in
                GroupWeeklyBoardRow(group: group, standing: standing)
            }
            if let mine, mine.rank > 1, !shown.contains(where: { $0.user.isMe }) {
                HStack {
                    Image(systemName: "ellipsis")
                        .font(.system(size: FBIconSize.small, weight: .bold))
                        .foregroundStyle(FBColor.tertiaryText)
                        .frame(maxWidth: .infinity)
                }
                .padding(.vertical, 2)
                .accessibilityHidden(true)
                GroupWeeklyBoardRow(group: group, standing: mine)
            }
        }
    }

    @ViewBuilder
    private func footer(_ standings: [GroupGamesStore.Standing]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let mine = standings.first(where: { $0.user.isMe }) {
                Text(GroupsSearchCopy.yourRank(mine.rank, standings.count))
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.primaryText)
            } else {
                Text(GroupsSearchCopy.notOnBoard)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.primaryText)
            }
            if let champion = GroupGamesStore.shared.lastWeekChampion(group: group, in: bubbleStore) {
                Label(GroupsSearchCopy.lastWeekChampion(champion.isMe ? GroupsSearchCopy.you : champion.name), systemImage: "medal")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Text(GroupsSearchCopy.pointsRule)
                .font(.fbCaption)
                .foregroundStyle(FBColor.tertiaryText)
                .fixedSize(horizontal: false, vertical: true)
            if showsSeeAll {
                Button {
                    Haptics.light()
                    router.push(.bubbleFeature(GroupsSearchScreens.leaderboardRoute(for: group.id)))
                } label: {
                    Text(GroupsSearchCopy.seeFullBoard)
                }
                .buttonStyle(.fb(.secondary, height: 36))
                .accessibilityLabel(GroupsSearchCopy.seeFullBoard)
            }
        }
    }

    /// The weekly board needs the server's Group boards (not served yet).
    private var emptyState: some View {
        LiveDataStateView(kind: .notAvailable(LiveDataCopy.groupBoards), title: "Weekly board")
            .accessibilityElement(children: .combine)
    }
}

// MARK: - Leader

/// The week's leader with a trophy. Plays a one-shot celebration (a pop and a ring of sparkles)
/// the first time it appears each launch; Reduce Motion shows it still.
struct GroupTrophyLeaderRow: View {
    let group: FBGroup
    let standing: GroupGamesStore.Standing

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var burst: CGFloat = 1
    @State private var pop: CGFloat = 1

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                sparkles
                Circle()
                    .fill(GameColor.accentGradient)
                    .frame(width: 44, height: 44)
                Image(systemName: "trophy.fill")
                    .font(.system(size: FBIconSize.large, weight: .bold))
                    .foregroundStyle(.white)
            }
            .scaleEffect(pop)
            .frame(width: 56, height: 56)
            AvatarView(user: standing.user, size: FBAvatarSize.compact)
            VStack(alignment: .leading, spacing: 3) {
                Text(GroupsSearchCopy.leaderBadge)
                    .font(.fbCaptionEmphasized)
                    .textCase(.uppercase)
                    .foregroundStyle(FBColor.savedPurple)
                Text(standing.user.isMe ? GroupsSearchCopy.youLead : GroupsSearchCopy.leads(standing.user.firstName))
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(GroupsSearchCopy.points(standing.points)) · \(GroupsSearchCopy.gamesPlayed(standing.gamesPlayed))")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(GameColor.accentGradient.opacity(0.45), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(GroupsSearchCopy.leaderA11y(standing.user.isMe ? GroupsSearchCopy.youLead : GroupsSearchCopy.leads(standing.user.name), standing.points))
        .onAppear(perform: celebrate)
    }

    /// Eight sparkles that fly out once and fade.
    private var sparkles: some View {
        ZStack {
            ForEach(0..<8, id: \.self) { index in
                let angle = Double(index) / 8 * 2 * .pi
                Image(systemName: index.isMultiple(of: 2) ? "sparkle" : "star.fill")
                    .font(.system(size: index.isMultiple(of: 2) ? 12 : 7, weight: .bold))
                    .foregroundStyle(index.isMultiple(of: 2) ? FBColor.savedPurple : FBColor.accent)
                    .offset(x: cos(angle) * 34 * burst, y: sin(angle) * 34 * burst)
                    .opacity(1 - burst)
                    .scaleEffect(0.6 + burst * 0.6)
            }
        }
        .accessibilityHidden(true)
    }

    private func celebrate() {
        let store = GroupGamesStore.shared
        guard !store.celebratedGroupIDs.contains(group.id) else { return }
        store.markCelebrated(group.id)
        guard !reduceMotion else { return }
        pop = 0.6
        burst = 0
        DispatchQueue.main.async {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.5)) {
                pop = 1
            }
            withAnimation(.easeOut(duration: 1.1)) {
                burst = 1
            }
            Haptics.success()
        }
    }
}

// MARK: - Most improved

struct GroupMostImprovedRow: View {
    let group: FBGroup
    let standing: GroupGamesStore.Standing

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                Text(GroupsSearchCopy.mostImproved)
                    .font(.fbCaptionEmphasized)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(GroupBoardStyle.improvedTint, in: Capsule())
            AvatarView(user: standing.user, size: FBAvatarSize.reply)
            Text(GroupsSearchCopy.mostImprovedLine(standing.user.isMe ? GroupsSearchCopy.you : standing.user.firstName, standing.gain))
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(GroupsSearchCopy.mostImproved): \(GroupsSearchCopy.mostImprovedLine(standing.user.isMe ? GroupsSearchCopy.you : standing.user.name, standing.gain))")
    }
}

// MARK: - Row

/// One ranked person: rank, face, name, movement, points, and Add friend when you don't know them.
struct GroupWeeklyBoardRow: View {
    let group: FBGroup
    let standing: GroupGamesStore.Standing

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let user = standing.user
        HStack(spacing: 10) {
            Text("\(standing.rank)")
                .font(.fbName)
                .monospacedDigit()
                .foregroundStyle(FBColor.secondaryText)
                .frame(minWidth: 22)
            Button {
                router.push(.profile(user))
            } label: {
                HStack(spacing: 10) {
                    AvatarView(user: user, size: FBAvatarSize.post)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(user.isMe ? GroupsSearchCopy.you : user.name)
                                .font(.fbName)
                                .foregroundStyle(FBColor.primaryText)
                                .lineLimit(1)
                            if standing.isMostImproved {
                                Image(systemName: "chart.line.uptrend.xyaxis")
                                    .font(.system(size: FBIconSize.xs, weight: .bold))
                                    .foregroundStyle(GroupBoardStyle.improvedTint)
                                    .accessibilityHidden(true)
                            }
                        }
                        HStack(spacing: 6) {
                            Text(GroupsSearchCopy.points(standing.points))
                                .monospacedDigit()
                            movement
                        }
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            trailing(user)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, user.isMe ? 8 : 0)
        .background(user.isMe ? FBColor.tintedBlueBackground : Color.clear, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(GroupsSearchCopy.rowA11y(standing.rank, user.isMe ? GroupsSearchCopy.you : user.name, standing.points))
    }

    @ViewBuilder
    private var movement: some View {
        if let change = standing.rankChange {
            if change > 0 {
                Label(GroupsSearchCopy.up(change), systemImage: "arrow.up")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(FBColor.accent)
            } else if change < 0 {
                Label(GroupsSearchCopy.down(-change), systemImage: "arrow.down")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(FBColor.secondaryText)
            }
        } else {
            Text(GroupsSearchCopy.new)
                .foregroundStyle(FBColor.accent)
        }
    }

    @ViewBuilder
    private func trailing(_ user: User) -> some View {
        switch user.friendship {
        case .me:
            EmptyView()
        case .friends:
            Text(GroupsSearchCopy.friend)
                .font(.fbMeta)
                .foregroundStyle(FBColor.tertiaryText)
        case .requestSent:
            Text(GroupsSearchCopy.requested)
                .font(.fbButton)
                .foregroundStyle(FBColor.secondaryText)
        case .requestReceived:
            Button(GroupsSearchCopy.confirm) {
                Haptics.success()
                appStore.confirmRequest(from: user)
                BubbleSocialSignals.post(.addFriendFromGame, bubbleID: boardBubbleID, with: [user.id])
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
            .accessibilityLabel(GroupsSearchCopy.confirmA11y(user.name))
        case .none:
            Button {
                Haptics.light()
                GroupWeeklyBoardActions.addFriend(user, group: group, appStore: appStore, bubbleStore: bubbleStore)
            } label: {
                Label(GroupsSearchCopy.addFriend, systemImage: "person.badge.plus")
                    .labelStyle(.titleAndIcon)
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 32))
            .accessibilityLabel(GroupsSearchCopy.addFriendA11y(user.name))
        }
    }

    private var boardBubbleID: String {
        bubbleStore.worldDailyBubble(for: group)?.id ?? bubbleStore.worldBubbles(in: group).first?.id ?? ""
    }
}
