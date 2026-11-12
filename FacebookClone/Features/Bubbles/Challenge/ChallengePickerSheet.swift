import SwiftUI

/// "Challenge Me": who to challenge with this run. Friends, recent chats (group chats first) and
/// your Groups, with a preview of the card they'll get. Each row sends on its own, like
/// Messenger's share sheet, so you can challenge Maya and the crew in one go.
///
/// A friend or 1:1 chat gets a same-seed challenge; a group chat or a Group gets a shared session
/// (docs/BUBBLES.md 7.2).
struct ChallengePickerSheet: View {
    let bubbleID: String
    /// The run you're challenging with. Nil uses your best (or none, so they play first).
    let draft: ChallengeCenter.Draft?

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss

    @State private var sentIDs: Set<String> = []

    private var center: ChallengeCenter { ChallengeCenter.shared }

    var body: some View {
        NavigationStack {
            Group {
                if let bubble = bubbleStore.bubble(id: bubbleID) {
                    content(bubble, draft: resolvedDraft(bubble))
                } else {
                    ContentUnavailableView("This Bubble popped", systemImage: "bubbles.and.sparkles", description: Text("It isn't available anymore."))
                }
            }
            .background(FBColor.surface)
            .navigationTitle(ChallengeCopy.pickerTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(ChallengeCopy.done) { dismiss() }
                        .font(.fbButton)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .overlay(alignment: .bottom) {
            ToastHost().padding(.bottom, 16)
        }
    }

    private func resolvedDraft(_ bubble: Bubble) -> ChallengeCenter.Draft {
        if let draft { return draft }
        let best = center.bestDraft(for: bubble)
        #if DEBUG
        if best.score == nil, DebugLaunch.value("FB_OPEN")?.hasPrefix("feature:challenge/picker") == true {
            // QA staging only: a 34 to show the preview without playing first.
            return ChallengeCenter.Draft(bubbleID: bubble.id, seed: best.seed, length: best.length, score: 34, replay: nil, scoreID: nil)
        }
        #endif
        return best
    }

    private func content(_ bubble: Bubble, draft: ChallengeCenter.Draft) -> some View {
        let targets = BubbleSocialHub.targets(appStore: appStore, kinds: [.friend, .chat, .group])
        let chats = targets.filter { $0.kind == .chat }
        let friends = targets.filter { target in
            // A friend you already have a chat with shows once, under Recent chats.
            target.kind == .friend && !chats.contains { chat in
                appStore.conversations.first { $0.id == chat.targetID }.map { !$0.isGroup && $0.participants.first?.id == target.targetID } ?? false
            }
        }
        let groups = targets.filter { $0.kind == .group }
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ChallengePreviewCard(bubble: bubble, score: draft.score, me: appStore.me)
                    .padding(.horizontal, FBMetrics.screenPadding)
                    .padding(.top, 8)
                    .padding(.bottom, 12)
                section(ChallengeCopy.recentChats, chats, bubble: bubble, draft: draft)
                section(ChallengeCopy.friends, friends, bubble: bubble, draft: draft)
                section(ChallengeCopy.yourGroups, groups, bubble: bubble, draft: draft)
            }
            .padding(.bottom, 32)
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ targets: [BubbleShareTarget], bubble: Bubble, draft: ChallengeCenter.Draft) -> some View {
        if !targets.isEmpty {
            Text(title)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.top, 16)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            ForEach(targets) { target in
                ChallengeTargetRow(target: target, isSent: sentIDs.contains(target.id)) {
                    send(draft, to: target, bubble: bubble)
                }
            }
        }
    }

    private func send(_ draft: ChallengeCenter.Draft, to target: BubbleShareTarget, bubble: Bubble) {
        guard !sentIDs.contains(target.id) else { return }
        if center.send(draft, to: target, bubble: bubble) {
            Haptics.success()
            withAnimation(.easeInOut(duration: 0.2)) {
                _ = sentIDs.insert(target.id)
            }
        } else {
            Haptics.error()
        }
    }
}

/// What the other side will see: the cover, "Beat my 34 in Hill Hopper", and you.
struct ChallengePreviewCard: View {
    let bubble: Bubble
    let score: Int?
    let me: User

    var body: some View {
        HStack(spacing: 12) {
            BubbleCoverView(bubble: bubble, showsEmoji: true)
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(ChallengeCopy.preview(score, title: bubble.title))
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(ChallengeCopy.sameSeedNote)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            AvatarView(user: me, size: FBAvatarSize.story)
        }
        .padding(12)
        .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Preview: \(ChallengeCopy.preview(score, title: bubble.title))")
    }
}

/// A friend, chat or Group with a Send button.
struct ChallengeTargetRow: View {
    let target: BubbleShareTarget
    let isSent: Bool
    let onSend: () -> Void

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        HStack(spacing: 12) {
            ChallengeTargetAvatar(target: target)
            VStack(alignment: .leading, spacing: 2) {
                Text(target.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button(action: onSend) {
                if isSent {
                    Label(ChallengeCopy.sent, systemImage: "checkmark")
                } else {
                    Text(ChallengeCopy.send)
                }
            }
            .buttonStyle(.fb(isSent ? .secondary : .primary, expand: false, height: 32))
            .disabled(isSent)
            .accessibilityLabel(isSent ? "Sent to \(target.title)" : "Send challenge to \(target.title)")
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.vertical, 8)
    }

    private var subtitle: String {
        switch target.kind {
        case .chat:
            if let chat = appStore.conversations.first(where: { $0.id == target.targetID }) {
                return chat.isGroup ? ChallengeCopy.members(chat.participants.count + 1) : (chat.primaryUser?.activeStatusText ?? ChallengeCopy.chatSubtitle)
            }
            return ChallengeCopy.chatSubtitle
        case .group:
            return ChallengeCopy.groupMembers(appStore.group(id: target.targetID)?.memberCount ?? 0)
        case .friend:
            return appStore.user(id: target.targetID)?.activeStatusText ?? ChallengeCopy.friendSubtitle
        case .feed, .story:
            return ""
        }
    }
}

/// A target's picture: an avatar, two overlapping avatars for a group chat, or a Group's cover.
struct ChallengeTargetAvatar: View {
    let target: BubbleShareTarget
    var size: CGFloat = FBAvatarSize.compact

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        switch target.kind {
        case .friend:
            AvatarView(user: bubbleStore.resolvePerson(target.targetID), size: size)
        case .chat:
            if let chat = appStore.conversations.first(where: { $0.id == target.targetID }) {
                if chat.isGroup {
                    MessengerGroupAvatar(users: chat.participants, size: size)
                } else if let user = chat.primaryUser {
                    AvatarView(user: user, size: size)
                }
            }
        case .group:
            RemoteImage(url: appStore.group(id: target.targetID)?.coverURL)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .accessibilityHidden(true)
        case .feed, .story:
            AvatarView(user: appStore.me, size: size)
        }
    }
}
