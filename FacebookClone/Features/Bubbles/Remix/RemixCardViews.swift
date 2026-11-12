import SwiftUI

// Remix cards in chats and posts, and the 'Send it back' sheet (docs/BUBBLES.md 7.5).

/// Who can send a remix back, and to whom.
@MainActor
enum RemixSendBack {
    /// True for your own remix of someone else's game.
    static func canSendBack(_ bubble: Bubble, store: BubbleStore) -> Bool {
        guard bubble.creator.id == store.appStore.me.id,
              let creator = RemixLineage.originalCreator(of: bubble, store: store) else { return false }
        return creator.id != store.appStore.me.id
    }
}

// MARK: - Card body

/// A `.remix` card: "Diego remixed your Hill Hopper → Fog Hopper", the two covers, Play and
/// Remix back.
struct RemixCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    private var remix: Bubble? { bubbleStore.bubble(id: card.extras[RemixCardKeys.remixID]?.string ?? card.bubbleID) }
    private var original: Bubble? { card.extras[RemixCardKeys.originalID]?.string.flatMap { bubbleStore.bubble(id: $0) } }
    private var isPost: Bool {
        if case .post = placement { return true }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            covers
                .frame(height: 112)
                .frame(maxWidth: .infinity)
                .clipped()
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 4) {
                    Image(systemName: "wand.and.sparkles")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                    Text(RemixCopy.cardTag)
                        .font(.fbCaptionEmphasized)
                }
                .foregroundStyle(FBColor.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(FBColor.tintedBlueBackground, in: Capsule())
                Text(headline)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if remix == nil {
                    Text(RemixCopy.cardUnavailable)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                HStack(spacing: 8) {
                    Button {
                        Haptics.light()
                        RemixNav.leavingCovers(router: router) {
                            BubbleSocialHub.play(card, router: router)
                        }
                    } label: {
                        Label(RemixCopy.play, systemImage: "play.fill")
                    }
                    .buttonStyle(.fb(.primary, height: 36))
                    .accessibilityLabel(RemixCopy.playLabel(remix?.title))
                    Button {
                        Haptics.light()
                        if let remix {
                            RemixNav.openStudio(remixing: remix.id, router: router)
                        }
                    } label: {
                        Label(RemixCopy.remixBack, systemImage: "wand.and.sparkles")
                    }
                    .buttonStyle(.fb(.tinted, height: 36))
                    .accessibilityLabel(RemixCopy.remixBackLabel(remix?.title))
                }
                .disabled(remix == nil)
            }
            .padding(12)
        }
        .frame(width: isPost ? nil : 264)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(FBColor.divider, lineWidth: 1)
        )
        .padding(isPost ? EdgeInsets(top: 0, leading: FBMetrics.gutter, bottom: 8, trailing: FBMetrics.gutter) : EdgeInsets())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(headline)
    }

    /// Original → remix, side by side.
    private var covers: some View {
        HStack(spacing: 0) {
            cover(original)
            ZStack {
                Rectangle().fill(FBColor.background)
                Image(systemName: "arrow.right")
                    .font(.system(size: FBIconSize.regular, weight: .bold))
                    .foregroundStyle(FBColor.accent)
            }
            .frame(width: 32)
            .accessibilityHidden(true)
            cover(remix)
        }
    }

    @ViewBuilder
    private func cover(_ bubble: Bubble?) -> some View {
        if let bubble {
            BubbleCoverView(bubble: bubble, showsEmoji: true)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .accessibilityHidden(true)
        } else {
            BubbleGlow.lilacHaze.gradient
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityHidden(true)
        }
    }

    private var headline: String {
        let originalTitle = original?.title ?? remix?.manifest.lineage.remixOfTitle
        let remixTitle = remix?.title
        guard let originalTitle, let remixTitle else { return card.headline }
        let me = appStore.me.id
        if card.fromUserID == me {
            let owner = original.map { $0.creator.id == me ? nil : $0.creator.firstName } ?? remix?.manifest.lineage.remixOfCreatorName
            return RemixCopy.cardFromMe(owner, original: originalTitle, remix: remixTitle)
        }
        if original?.creator.id == me {
            let sender = bubbleStore.resolvePerson(card.fromUserID).firstName
            return RemixCopy.cardFromThem(sender, original: originalTitle, remix: remixTitle)
        }
        return card.headline
    }
}

// MARK: - Send it back

/// 'Send it back': shows the card your remix makes, then puts it in the original creator's chat.
struct RemixSendBackSheet: View {
    let bubbleID: String
    /// From inside the player: closes it before opening the chat (`BubbleResultSlotContext`).
    var exitPlayer: ((@escaping () -> Void) -> Void)? = nil

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var chat: Conversation?
    @State private var previewCard: BubbleChatCard?

    var body: some View {
        NavigationStack {
            Group {
                if let bubble = bubbleStore.bubble(id: bubbleID) {
                    content(bubble)
                } else {
                    ContentUnavailableView(RemixCopy.notFound, systemImage: "bubbles.and.sparkles", description: Text(RemixCopy.cardUnavailable))
                }
            }
            .background(FBColor.surface)
            .navigationTitle(RemixCopy.sendBackTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(chat == nil ? RemixCopy.notNow : RemixCopy.done) { close() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private func content(_ bubble: Bubble) -> some View {
        let creator = RemixLineage.originalCreator(of: bubble, store: bubbleStore)
        if !RemixLineage.isRemix(bubble) || creator == nil {
            message(RemixCopy.sendBackNotRemix, symbol: "wand.and.sparkles")
        } else if let creator, creator.id == appStore.me.id {
            message(RemixCopy.sendBackYourOwn, symbol: "person.crop.circle")
        } else if let creator {
            ScrollView {
                VStack(spacing: 18) {
                    HStack(spacing: -10) {
                        RemixAvatar(user: appStore.me, size: 56)
                        RemixAvatar(user: creator, size: 56, highlighted: creator.isFriend)
                    }
                    .accessibilityHidden(true)
                    Text(RemixCopy.sendBackBody(creator.firstName, original: bubble.manifest.lineage.remixOfTitle ?? RemixLineage.original(of: bubble, in: bubbleStore.bubbles)?.title ?? "the original"))
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    if let card = previewCard {
                        BubbleChatCardView(card: card, placement: .chat(messageID: "preview", isFromMe: true))
                            .allowsHitTesting(false)
                            .accessibilityLabel(RemixCopy.previewLabel(card.headline))
                    }
                    if chat != nil {
                        Label(RemixCopy.sendBackSent(creator.firstName), systemImage: "checkmark.circle.fill")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.accent)
                            .multilineTextAlignment(.center)
                        Button {
                            Haptics.light()
                            openChat()
                        } label: {
                            Label(RemixCopy.openChat, systemImage: "message.fill")
                        }
                        .buttonStyle(.fb(.primary, height: 44))
                    } else {
                        Button {
                            send(bubble)
                        } label: {
                            Label(RemixCopy.sendBackTo(creator.firstName), systemImage: "arrowshape.turn.up.backward.fill")
                        }
                        .buttonStyle(.fb(.primary, height: 44))
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.vertical, 20)
            }
            .onAppear {
                if previewCard == nil {
                    previewCard = RemixCenter.shared.sendBackCard(for: bubble, appStore: appStore, bubbleStore: bubbleStore)
                }
            }
        }
    }

    private func message(_ text: String, symbol: String) -> some View {
        ContentUnavailableView(RemixCopy.sendBackTitle, systemImage: symbol, description: Text(text))
    }

    private func send(_ bubble: Bubble) {
        if let sent = RemixCenter.shared.sendBack(bubble, appStore: appStore, bubbleStore: bubbleStore) {
            Haptics.success()
            withAnimation(.easeInOut(duration: 0.2)) { chat = sent }
        } else {
            Haptics.light()
            appStore.showToast(RemixCopy.shareFailed, symbol: "exclamationmark.circle")
        }
    }

    private func openChat() {
        guard let chat else { return }
        if let exitPlayer {
            dismiss()
            exitPlayer { router.openChat(chat) }
            return
        }
        RemixNav.leavingCovers(router: router, dismiss: { dismiss() }) {
            router.openChat(chat)
        }
    }

    private func close() {
        if router.bubbleSheet?.feature == .remix { router.bubbleSheet = nil }
        dismiss()
    }
}
