import SwiftUI

// Contribution cards in Messenger chats and Group posts (docs/BUBBLES.md 7.4), plus the small
// pieces the together screens share: the blue-to-purple badge, overlapping maker avatars and
// one contribution's content.

/// The together feature's decorative palette: Facebook blue to purple.
enum TogetherStyle {
    static let indigo = Color(hex: 0x5B4BFF)
    static var gradient: LinearGradient {
        LinearGradient(colors: [FBColor.brandBlue, indigo, FBColor.savedPurple], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// A round gradient badge with a symbol.
struct TogetherBadge: View {
    var symbol = "person.3.sequence.fill"
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(TogetherStyle.gradient, in: Circle())
            .accessibilityHidden(true)
    }
}

/// Overlapping avatars of the people making something.
struct TogetherMakersStack: View {
    let users: [User]
    var size: CGFloat = 28
    var limit = 4

    var body: some View {
        HStack(spacing: -size * 0.32) {
            ForEach(Array(users.prefix(limit).enumerated()), id: \.element.id) { index, user in
                AvatarView(user: user, size: size)
                    .overlay(Circle().stroke(FBColor.surface, lineWidth: 2))
                    .zIndex(Double(limit - index))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(TogetherStudio.names(users.map(\.firstName)))
    }
}

/// One contribution's content: a question with its answer, word chips, or a scene or level line.
struct TogetherContributionContent: View {
    let kind: TogetherAskKind
    let text: String
    var compact = false

    var body: some View {
        switch kind {
        case .question:
            if let parts = TogetherStudio.parseQuestion(text) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(parts.question)
                        .font(compact ? .fbName : .fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: FBIconSize.xs, weight: .bold))
                            .foregroundStyle(FBColor.online)
                        Text("\(TogetherCopy.answerLabel): \(parts.answer)")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    .accessibilityElement(children: .combine)
                }
            } else {
                plain
            }
        case .words:
            let words = TogetherStudio.parseWords(text)
            if words.isEmpty {
                plain
            } else {
                FlowLayout(spacing: 6) {
                    ForEach(words, id: \.word) { entry in
                        Text(entry.word)
                            .font(.fbCaptionEmphasized)
                            .foregroundStyle(FBColor.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(FBColor.tintedBlueBackground, in: Capsule())
                    }
                }
            }
        case .scene, .level:
            plain
        }
    }

    private var plain: some View {
        Text(text)
            .font(compact ? .fbBody : .fbBodyLarge)
            .foregroundStyle(FBColor.primaryText)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Contribution cards: the invite, a friend's contribution, the finished game, a maker's play.
struct TogetherCardView: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    private var center: TogetherCenter { TogetherCenter.shared }
    private var session: TogetherSession? { center.session(for: card) }
    private var kind: TogetherAskKind {
        TogetherAskKind(rawValue: card.extras[TogetherCard.kindKey]?.string ?? "") ?? session?.kind ?? .question
    }
    private var title: String { card.extras[TogetherCard.titleKey]?.string ?? session?.title ?? "" }
    private var isPost: Bool {
        if case .post = placement { return true }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch TogetherCard.stage(of: card) {
            case .invite: invite
            case .contribution: contribution
            case .published: published
            case .played: played
            }
        }
        .frame(width: isPost ? nil : 264)
        .frame(maxWidth: isPost ? .infinity : nil, alignment: .leading)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(FBColor.divider, lineWidth: 1)
        )
        .padding(isPost ? EdgeInsets(top: 0, leading: FBMetrics.gutter, bottom: 8, trailing: FBMetrics.gutter) : EdgeInsets())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.headline)
    }

    // MARK: Stages

    private var invite: some View {
        let ask = card.extras[TogetherCard.askKey]?.string ?? session?.ask ?? ""
        let friends = session?.friendEntries ?? []
        let people = uniqueMakers(friends.map(\.makerID))
        return VStack(alignment: .leading, spacing: 0) {
            header(symbol: TogetherCopy.kindSymbol(kind), label: TogetherCopy.startTitle)
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                if !ask.isEmpty {
                    Text(ask)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !people.isEmpty {
                    HStack(spacing: 8) {
                        TogetherMakersStack(users: people, size: 24)
                        Text(TogetherCopy.addedCount(friends.count))
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                sessionButton(TogetherCopy.addYoursButton, style: .primary)
            }
            .padding(12)
        }
    }

    private var contribution: some View {
        let text = card.extras[TogetherCard.textKey]?.string ?? ""
        let maker = bubbleStore.resolvePerson(card.fromUserID)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                AvatarView(user: maker, size: 28)
                VStack(alignment: .leading, spacing: 0) {
                    Text(maker.isMe ? appStore.me.firstName : maker.firstName)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("added \(TogetherCopy.kindNoun(kind)) to \(title)")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                TogetherBadge(symbol: TogetherCopy.kindSymbol(kind), size: 26)
            }
            TogetherContributionContent(kind: kind, text: text, compact: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            if session?.bubbleID == nil {
                sessionButton(TogetherCopy.openButton, style: .tinted)
            } else {
                Label(TogetherCopy.questionStitched, systemImage: "checkmark.seal.fill")
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.accent)
            }
        }
        .padding(12)
    }

    @ViewBuilder
    private var published: some View {
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        let makers = bubble?.manifest.lineage.makers ?? []
        let people = makers.map { bubbleStore.resolvePerson($0.id) }
        let credit = card.extras[TogetherCard.makersKey]?.string
            ?? TogetherCopy.madeBy(makers.map { $0.id == appStore.me.id || $0.id == "me" ? nil : $0.name })
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                if let bubble {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                } else {
                    TogetherStyle.gradient
                }
                Label(TogetherCopy.madeTogether, systemImage: "person.3.sequence.fill")
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.black.opacity(0.35), in: Capsule())
                    .padding(8)
            }
            .frame(height: 124)
            .frame(maxWidth: .infinity)
            .clipped()
            VStack(alignment: .leading, spacing: 8) {
                Text(card.headline)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if !credit.isEmpty {
                    HStack(spacing: 8) {
                        TogetherMakersStack(users: people, size: 22)
                        Text(credit)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(2)
                    }
                }
                HStack(spacing: 8) {
                    Button {
                        Haptics.light()
                        let context = BubblePlayContext(kind: .contribution, id: card.sessionID ?? card.id, cardID: card.id)
                        TogetherNav.afterCovers(router) {
                            BubbleSocialHub.play(card, router: router, context: context)
                        }
                    } label: {
                        Label(TogetherCopy.playButton, systemImage: "play.fill")
                    }
                    .buttonStyle(.fb(.primary, height: 36))
                    .disabled(bubble == nil)
                    .accessibilityLabel("\(TogetherCopy.playButton) \(title)")
                    NavigationLink(value: Route.bubble(card.bubbleID)) {
                        Text(TogetherCopy.openGame)
                    }
                    .buttonStyle(.fb(.secondary, expand: false, height: 36))
                    .disabled(bubble == nil)
                }
            }
            .padding(12)
        }
    }

    private var played: some View {
        let player = bubbleStore.resolvePerson(card.fromUserID)
        let line = card.extras[TogetherCard.textKey]?.string
        return HStack(spacing: 10) {
            AvatarView(user: player, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.headline)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                if let line {
                    Text(line)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            Button {
                Haptics.light()
                TogetherNav.afterCovers(router) {
                    BubbleSocialHub.play(card, router: router, context: BubblePlayContext(kind: .contribution, id: card.sessionID ?? card.id, cardID: card.id, opponentName: player.firstName, target: card.score))
                }
            } label: {
                Image(systemName: "play.fill")
                    .font(.system(size: FBIconSize.small, weight: .bold))
                    .frame(width: 36, height: 36)
                    .foregroundStyle(FBColor.accent)
                    .background(FBColor.tintedBlueBackground, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(bubbleStore.bubble(id: card.bubbleID) == nil)
            .accessibilityLabel("\(TogetherCopy.playButton) \(title)")
        }
        .padding(12)
    }

    // MARK: Pieces

    private func header(symbol: String, label: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.small, weight: .bold))
            Text(label)
                .font(.fbCaptionEmphasized)
            Spacer(minLength: 0)
            BubbleOrb(size: 16)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(TogetherStyle.gradient)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func sessionButton(_ title: String, style: FBButtonStyle.Kind) -> some View {
        if let session {
            NavigationLink(value: Route.bubbleFeature(BubbleFeatureRoute(.together, "session", session.id))) {
                Text(session.bubbleID == nil ? title : TogetherCopy.openGame)
            }
            .buttonStyle(.fb(style, height: 34))
            .accessibilityHint(session.title)
        } else {
            Text(TogetherCopy.sessionGone)
                .font(.fbMeta)
                .foregroundStyle(FBColor.tertiaryText)
        }
    }

    private func uniqueMakers(_ ids: [String]) -> [User] {
        var seen = Set<String>()
        return ids.filter { seen.insert($0).inserted }.map { bubbleStore.resolvePerson($0) }
    }
}
