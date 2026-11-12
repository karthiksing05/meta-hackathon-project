import SwiftUI

// The top of a Group's Games tab (docs/BUBBLES.md 7.3): today's Daily Bubble, the weekly
// leaderboard, "Challenge the Group" and the game-night entry point.

/// Builds and sends a "Challenge the Group" post through the shared card API. The card is a
/// `.session` with no session id sent to a Group, which the challenge feature turns into a shared
/// session (same seed for everyone, members' runs arriving live).
@MainActor
enum GroupChallengeComposer {
    @discardableResult
    static func post(bubble: Bubble, in group: FBGroup, appStore: AppStore, bubbleStore: BubbleStore) -> Post? {
        let myBest = bubbleStore.bestScore(of: appStore.me, in: bubble)?.score
        let card = BubbleChatCard(
            kind: .session,
            bubbleID: bubble.id,
            seed: bubble.manifest.seed,
            length: bubble.manifest.length,
            fromUserID: appStore.me.id,
            headline: GroupsSearchCopy.challengeHeadline(bubble.title),
            sessionID: nil,
            score: myBest,
            extras: [
                "origin": .string("groups-search"),
                "group_id": .string(group.id),
            ]
        )
        let target = BubbleShareTarget(kind: .group, targetID: group.id, title: group.name)
        let note = GroupsSearchCopy.challengeNote(bubble.title, myBest, group.name)
        guard BubbleSocialHub.send(card, to: target, note: note, appStore: appStore, bubbleStore: bubbleStore) else { return nil }
        let post = appStore.posts.first { $0.bubbleCard?.id == card.id }
        if let post {
            GroupGamesStore.shared.noteChallengePost(post.id, in: group.id)
        }
        let others = GroupGamesStore.shared.memberIDs(of: group, in: bubbleStore)
        BubbleSocialSignals.post(.groupChallenge, bubbleID: bubble.id, with: others)
        appStore.showToast(GroupsSearchCopy.challengePosted(group.name), symbol: "trophy.fill")
        return post
    }
}

/// `GroupsSearchGamesHub` body.
struct GroupGamesHubView: View {
    let group: FBGroup

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    @State private var showsChallengePicker = false

    var body: some View {
        let daily = bubbleStore.worldDailyBubble(for: group)
        VStack(spacing: 0) {
            FeedSeparator()
            if let daily {
                VStack(alignment: .leading, spacing: 10) {
                    Text(GroupsSearchCopy.dailyTitle)
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    BubbleGroupDailyCard(group: group, bubble: daily)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FBColor.surface)
                FeedSeparator()
            }
            GroupWeeklyBoardCard(group: group)
            if hasGames {
                FeedSeparator()
                challengeCard
            }
            FeedSeparator()
            gameNightCard
            FeedSeparator()
        }
        .sheet(isPresented: $showsChallengePicker) {
            GroupChallengePickerSheet(group: group)
        }
    }

    private var hasGames: Bool {
        !bubbleStore.worldBubbles(in: group).filter { !$0.isIcebreaker }.isEmpty
    }

    // MARK: Challenge the Group

    private var challengeCard: some View {
        let postIDs = GroupGamesStore.shared.challengePostIDs[group.id] ?? []
        let livePost = postIDs.last.flatMap { appStore.post(id: $0) }
        let faces = Array(GroupGamesStore.shared.memberIDs(of: group, in: bubbleStore).prefix(5)).map { bubbleStore.resolvePerson($0) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "flag.checkered.2.crossed")
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(GroupBoardStyle.trophyGradient, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(GroupsSearchCopy.challengeTitle)
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    Text(GroupsSearchCopy.challengeDetail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            if !faces.isEmpty {
                AvatarStack(users: faces, size: FBAvatarSize.reply, maxCount: 5)
                    .accessibilityHidden(true)
            }
            Button {
                Haptics.light()
                showsChallengePicker = true
            } label: {
                Label(GroupsSearchCopy.challengeButton, systemImage: "trophy")
            }
            .buttonStyle(.fb(.primary, height: 40))
            .accessibilityLabel(GroupsSearchCopy.challengeButton)
            if let livePost {
                Button {
                    router.push(.post(livePost))
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(FBColor.online)
                        Text(GroupsSearchCopy.challengeLive)
                            .foregroundStyle(FBColor.primaryText)
                        Spacer(minLength: 0)
                        Text(GroupsSearchCopy.viewPost)
                            .foregroundStyle(FBColor.accent)
                    }
                    .font(.fbMetaEmphasized)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(GroupsSearchCopy.challengeLive). \(GroupsSearchCopy.viewPost)")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    // MARK: Game night

    private var gameNightCard: some View {
        Button {
            Haptics.light()
            BubbleFeatureRouter.open(GroupsSearchScreens.gameNightRoute(for: group.id), router: router)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: BubbleCategory.party.symbol)
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.savedPurple)
                    .frame(width: 40, height: 40)
                    .background(FBColor.savedPurple.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(GroupsSearchCopy.gameNightTitle)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(GroupsSearchCopy.gameNightDetail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Text(GroupsSearchCopy.gameNightButton)
                    .font(.fbButton)
                    .foregroundStyle(FBColor.accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(GroupsSearchCopy.gameNightButton). \(GroupsSearchCopy.gameNightDetail)")
    }
}

// MARK: - Picker

/// `router.bubbleSheet` for `groups-search/challenge/<groupID>`.
struct GroupChallengeSheetLoader: View {
    let groupID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        if let group = appStore.group(id: groupID) ?? bubbleStore.resolveGroup(groupID) {
            GroupChallengePickerSheet(group: group)
        } else {
            ContentUnavailableView(GroupsSearchCopy.groupMissing, systemImage: "person.3", description: Text(GroupsSearchCopy.groupMissingDetail))
        }
    }
}

/// Pick the Daily or one of the Group's games, then post the challenge to the Group feed.
struct GroupChallengePickerSheet: View {
    let group: FBGroup

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss

    @State private var selectedID: String?

    var body: some View {
        let daily = bubbleStore.worldDailyBubble(for: group)
        let games = bubbleStore.worldBubbles(in: group).filter { !$0.isIcebreaker }
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(GroupsSearchCopy.challengePickerSubtitle)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(.bottom, 4)
                    ForEach(games) { bubble in
                        row(bubble, isDaily: bubble.id == daily?.id)
                    }
                }
                .padding(16)
            }
            .background(FBColor.surface)
            .navigationTitle(GroupsSearchCopy.challengePickerTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(GroupsSearchCopy.cancel) { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    send(games)
                } label: {
                    Label(GroupsSearchCopy.challengeSend, systemImage: "paperplane.fill")
                }
                .buttonStyle(.fb(.primary, height: 44))
                .disabled(games.isEmpty)
                .padding(16)
                .background(FBColor.surface)
            }
            .onAppear {
                if selectedID == nil { selectedID = daily?.id ?? games.first?.id }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ bubble: Bubble, isDaily: Bool) -> some View {
        let selected = selectedID == bubble.id
        return Button {
            Haptics.selection()
            selectedID = bubble.id
        } label: {
            HStack(spacing: 12) {
                BubbleCoverView(bubble: bubble, showsEmoji: true)
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    if isDaily {
                        Text(GroupsSearchCopy.todaysDaily)
                            .font(.fbCaptionEmphasized)
                            .foregroundStyle(FBColor.accent)
                    }
                    Text(bubble.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text(bubble.rule)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: FBIconSize.large))
                    .foregroundStyle(selected ? FBColor.accent : FBColor.tertiaryText)
            }
            .padding(10)
            .background(selected ? FBColor.tintedBlueBackground : FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(isDaily ? GroupsSearchCopy.todaysDaily + ", " : "")\(bubble.title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func send(_ games: [Bubble]) {
        guard let bubble = games.first(where: { $0.id == selectedID }) ?? games.first else { return }
        Haptics.success()
        GroupChallengeComposer.post(bubble: bubble, in: group, appStore: appStore, bubbleStore: bubbleStore)
        dismiss()
    }
}
