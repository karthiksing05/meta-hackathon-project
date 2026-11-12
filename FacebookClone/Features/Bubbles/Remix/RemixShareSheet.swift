import SwiftUI

/// Share a Bubble (docs/BUBBLES.md 7.5): to your feed, a Group, a chat, a friend or your story.
/// Everything but the story gets a playable card (`.share`) with the seed and length, and your
/// score when you share from a result, so whoever opens it plays the same game.
struct RemixShareSheet: View {
    let bubble: Bubble
    /// The run you're sharing, from the result sheet.
    var result: BubbleRunResult? = nil
    /// The player's request, so a shared challenge keeps its seed and length.
    var request: BubblePlayRequest? = nil

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(\.dismiss) private var dismiss
    @Environment(Router.self) private var router

    @State private var note = ""
    @State private var failed: String?

    private var center: RemixCenter { RemixCenter.shared }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    header
                    TextField(RemixCopy.notePlaceholder, text: $note, axis: .vertical)
                        .font(.fbBody)
                        .lineLimit(1...3)
                        .accessibilityLabel(RemixCopy.notePlaceholder)
                }
                let all = targets
                section(nil, all.filter { $0.kind == .feed || $0.kind == .story })
                section(RemixCopy.chats, all.filter { $0.kind == .chat })
                section(RemixCopy.groups, all.filter { $0.kind == .group })
                section(RemixCopy.friends, all.filter { $0.kind == .friend })
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(FBColor.background)
            .navigationTitle(RemixCopy.shareTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(RemixCopy.done) { close() }
                        .font(.fbButton)
                }
            }
            .overlay(alignment: .bottom) {
                if let failed {
                    Text(failed)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(FBColor.toastBackground, in: Capsule())
                        .padding(.bottom, 16)
                        .transition(.opacity)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var score: Int? { result?.score }

    private var header: some View {
        HStack(spacing: 12) {
            BubbleCoverView(bubble: bubble, showsEmoji: true)
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(score.map { RemixCopy.shareHeadline(score: $0, title: bubble.title) } ?? RemixCopy.shareHeadline(title: bubble.title))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                Text(RemixCopy.shareSubtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// Feed and story, chats (group chats first), Groups, then friends you don't already have a
    /// chat with in the list.
    private var targets: [BubbleShareTarget] {
        let all = BubbleSocialHub.targets(appStore: appStore, kinds: [.feed, .story, .chat, .group, .friend])
        let chatPartners: Set<String> = Set(all.filter { $0.kind == .chat }.compactMap { target in
            guard let chat = appStore.conversations.first(where: { $0.id == target.targetID }), !chat.isGroup else { return nil }
            return chat.participants.first?.id
        })
        return all.filter { $0.kind != .friend || !chatPartners.contains($0.targetID) }
    }

    @ViewBuilder
    private func section(_ title: String?, _ rows: [BubbleShareTarget]) -> some View {
        if !rows.isEmpty {
            Section {
                ForEach(rows) { target in
                    row(target)
                }
            } header: {
                if let title {
                    Text(title)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
        }
    }

    private func row(_ target: BubbleShareTarget) -> some View {
        let sent = center.didShare(bubble, to: target)
        return HStack(spacing: 12) {
            avatar(target)
            VStack(alignment: .leading, spacing: 1) {
                Text(target.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text(subtitle(target))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                share(to: target)
            } label: {
                if sent {
                    Label(RemixCopy.sent, systemImage: "checkmark")
                } else {
                    Text(RemixCopy.send)
                }
            }
            .buttonStyle(.fb(sent ? .secondary : .primary, expand: false, height: 32))
            .disabled(sent)
            .accessibilityLabel(sent ? "\(RemixCopy.sent) to \(target.title)" : "\(RemixCopy.send) to \(target.title)")
        }
        .padding(.vertical, 2)
        .listRowBackground(FBColor.surface)
    }

    private func subtitle(_ target: BubbleShareTarget) -> String {
        switch target.kind {
        case .feed: return RemixCopy.yourFeedSub
        case .story: return RemixCopy.yourStorySub
        case .group: return RemixCopy.groupSub
        case .chat:
            let chat = appStore.conversations.first { $0.id == target.targetID }
            if let chat, chat.isGroup { return RemixCopy.groupChatSub(chat.participants.count + 1) }
            return RemixCopy.chatSub
        case .friend:
            return RemixCopy.friend
        }
    }

    @ViewBuilder
    private func avatar(_ target: BubbleShareTarget) -> some View {
        let size = FBAvatarSize.post
        switch target.kind {
        case .feed:
            AvatarView(user: appStore.me, size: size)
        case .story:
            AvatarView(user: appStore.me, size: size - 4, ring: .story(seen: false))
        case .group:
            RemoteImage(url: appStore.group(id: target.targetID)?.coverURL)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        case .chat:
            let people = appStore.conversations.first { $0.id == target.targetID }?.participants ?? []
            if people.count > 1 {
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(user: people[0], size: size * 0.7)
                        .frame(width: size, height: size, alignment: .topLeading)
                    RemixAvatar(user: people[1], size: size * 0.7)
                }
                .frame(width: size, height: size)
            } else if let person = people.first {
                AvatarView(user: person, size: size)
            } else {
                Circle().fill(FBColor.buttonGray).frame(width: size, height: size)
            }
        case .friend:
            AvatarView(user: appStore.user(id: target.targetID) ?? bubbleStore.resolvePerson(target.targetID), size: size)
        }
    }

    private func share(to target: BubbleShareTarget) {
        let ok = center.share(
            bubble,
            to: target,
            score: score,
            result: result,
            request: request,
            note: note,
            appStore: appStore,
            bubbleStore: bubbleStore
        )
        if ok {
            Haptics.success()
        } else {
            Haptics.light()
            withAnimation(.easeInOut(duration: 0.2)) { failed = RemixCopy.shareFailed }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                withAnimation(.easeInOut(duration: 0.2)) { failed = nil }
            }
        }
    }

    private func close() {
        if router.bubbleSheet?.feature == .remix { router.bubbleSheet = nil }
        dismiss()
    }
}

/// A remix route shown as a sheet (or pushed): `share/<id>` and `sendback/<id>`.
struct RemixRouteSheet: View {
    let route: BubbleFeatureRoute

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        switch route.screen {
        case RemixScreens.share:
            if let bubble = bubbleStore.bubble(id: route.arg) {
                RemixShareSheet(bubble: bubble)
            } else {
                ContentUnavailableView("Bubble not found", systemImage: "bubbles.and.sparkles", description: Text(RemixCopy.cardUnavailable))
            }
        case RemixScreens.sendBack:
            RemixSendBackSheet(bubbleID: route.arg)
        default:
            BubbleFeaturePlaceholder(route: route)
        }
    }
}
