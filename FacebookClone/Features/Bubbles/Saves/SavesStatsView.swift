import SwiftUI

/// Who saved a Bubble: the counts, then everyone who did, friends first, with Add friend for the
/// people you don't know yet. Opened by `SavesScreens` (`feature:saves/stats/<bubbleID>`), from
/// the saves notification and from the Bubble page.
struct SavesStatsView: View {
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        LoadedBubble(bubbleID: bubbleID) { bubble in
            content(bubble)
                .task(id: bubble.id) { bubbleStore.loadSavers(for: bubble) }
        }
        .background(FBColor.background)
        .navigationTitle(SavesCopy.statsTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ bubble: Bubble) -> some View {
        let savers = SavesSocialProof.savers(for: bubble, in: bubbleStore, limit: 30)
        let hidden = max(0, bubble.saveCount - savers.count)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(bubble)
                VStack(alignment: .leading, spacing: 4) {
                    Text(SavesCopy.whoSaved)
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                        .accessibilityAddTraits(.isHeader)
                    Text(SavesCopy.friendsFirst)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                if case .failed(let message) = bubbleStore.saverStates[bubble.id] {
                    LiveDataStateView(kind: .failed(message), title: "Couldn't load who saved it") {
                        bubbleStore.loadSavers(for: bubble, force: true)
                    }
                } else if savers.isEmpty, bubbleStore.saverStates[bubble.id] == .loading {
                    LiveDataStateView(kind: .loading, title: "Loading who saved it…")
                } else if savers.isEmpty, bubble.saveCount > 0 {
                    Text(SavesCopy.noFriendsSaved(bubble.saveCount))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .frame(maxWidth: .infinity)
                } else if savers.isEmpty {
                    emptyState(bubble)
                } else {
                    VStack(spacing: 0) {
                        ForEach(savers) { user in
                            SavesSaverRow(user: user, bubble: bubble)
                            if user.id != savers.last?.id {
                                Divider().padding(.leading, 64)
                            }
                        }
                    }
                    .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    if hidden > 0 {
                        Text(SavesCopy.andMore(hidden))
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
    }

    private func header(_ bubble: Bubble) -> some View {
        HStack(spacing: 14) {
            BubbleCoverView(bubble: bubble, showsEmoji: false)
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(bubble.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                Text(SavesCopy.savesCount(bubble.saveCount))
                    .font(.fbName)
                    .foregroundStyle(FBColor.accent)
                Text(SavesCopy.savesThisWeek(SavesSocialProof.savesThisWeek(bubble)))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func emptyState(_ bubble: Bubble) -> some View {
        VStack(spacing: 6) {
            Image(systemName: "bookmark")
                .font(.system(size: FBIconSize.xxl, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
            Text(SavesCopy.emptyTitle)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
            Text(SavesCopy.emptyBody)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }
}

/// One person who saved a Bubble: name, how you know them, Add friend for strangers.
struct SavesSaverRow: View {
    let user: User
    let bubble: Bubble

    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        HStack(spacing: 12) {
            Button {
                if !user.isMe { router.push(.profile(user)) }
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.isMe ? "You" : user.name)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(user.isMe ? "You" : user.name), \(subtitle)")
            trailing
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 60)
    }

    private var subtitle: String {
        if user.isMe { return SavesCopy.youSaved }
        if user.isFriend { return SavesCopy.friend }
        if user.mutualFriendCount > 0 { return SavesCopy.mutual(user.mutualFriendCount) }
        return SavesCopy.newInSF
    }

    @ViewBuilder
    private var trailing: some View {
        if user.isMe || user.isFriend {
            EmptyView()
        } else if user.friendship == .requestSent {
            Text(SavesCopy.requestSent)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
        } else {
            Button(user.friendship == .requestReceived ? SavesCopy.confirm : SavesCopy.addFriend) {
                Haptics.light()
                appStore.sendRequest(to: user)
                BubbleSocialSignals.post(.addFriendFromGame, bubbleID: bubble.id, with: [user.id])
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 34))
            .accessibilityLabel(user.friendship == .requestReceived ? "Confirm \(user.firstName)'s friend request" : "Add \(user.firstName) as a friend")
        }
    }
}
