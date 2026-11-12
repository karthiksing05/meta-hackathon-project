import SwiftUI

// Quiz night pieces shared by the lobby, podium, slots and the game night card (docs/BUBBLES.md 7.7).

/// Quiz night's own colors: Facebook blue into purple.
enum QuizNightStyle {
    static let blue = Color(hex: 0x3D6FE0)
    static let violet = Color(hex: 0x7B61D9)
    static let deep = Color(hex: 0x23205A)

    static var gradient: LinearGradient {
        LinearGradient(colors: [blue, violet], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// The small "QUIZ NIGHT" chip.
struct QuizNightChip: View {
    var live = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: live ? "dot.radiowaves.left.and.right" : BubbleCategory.party.symbol)
                .font(.system(size: FBIconSize.xs, weight: .bold))
            Text(live ? NextlineCopy.liveNow : NextlineCopy.quizNight)
                .font(.fbMicroEmphasized)
                .textCase(.uppercase)
        }
        .foregroundStyle(Color.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.white.opacity(0.22), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// One row of standings: rank, avatar, name, right answers, score.
struct QuizNightStandingRow: View {
    let rank: Int
    let user: User
    let score: Int?
    var detail: String? = nil
    var highlight = false

    var body: some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.fbMetaEmphasized)
                .monospacedDigit()
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 18)
            AvatarView(user: user, size: FBAvatarSize.comment)
            VStack(alignment: .leading, spacing: 1) {
                Text(user.isMe ? NextlineCopy.you : user.firstName)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                if let detail {
                    Text(detail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let score {
                Text(score.withCommas)
                    .font(.fbName)
                    .monospacedDigit()
                    .foregroundStyle(FBColor.primaryText)
            } else {
                Text(NextlineCopy.playing)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(highlight ? FBColor.tintedBlueBackground : Color.clear, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(score.map { NextlineCopy.standingLabel(rank, user.isMe ? NextlineCopy.you : user.firstName, $0) } ?? "\(user.firstName), \(NextlineCopy.playing)")
    }
}

// MARK: - The game night card (Messenger and Group posts)

/// A quiz night card: the scenes, the place, who's in, live standings and Join or See results.
/// Extras (docs/BUBBLES.md 7.7): night_id, bubble_id, rounds, members, standings [{user_id,
/// score}], winner_id, place_name.
struct QuizNightCard: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @State private var showsPodium = false

    private var center: QuizNightCenter { QuizNightCenter.shared }
    private var nightID: String? { card.extras["night_id"]?.string ?? card.sessionID }
    private var night: QuizNight? { nightID.flatMap { center.night(id: $0) } }

    var body: some View {
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        let standings = standingsFromCard()
        let rounds = card.extras["rounds"]?.int ?? card.length?.rounds ?? 5
        let members = card.extras["members"]?.int ?? standings.count
        let winner = card.extras["winner_id"]?.string.map { bubbleStore.resolvePerson($0) }
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                if let bubble {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                } else {
                    QuizNightStyle.gradient
                }
                LinearGradient(colors: [.clear, Color.black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 4) {
                    QuizNightChip(live: winner == nil)
                    Text(bubble?.title ?? card.headline)
                        .font(.fbHeadline)
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                    Text("\(NextlineCopy.roundsLabel(rounds)) · \(NextlineCopy.joinedCount(members))")
                        .font(.fbMeta)
                        .foregroundStyle(Color.white.opacity(0.9))
                }
                .padding(12)
            }
            .frame(height: 124)
            .frame(maxWidth: .infinity)
            .clipped()

            VStack(alignment: .leading, spacing: 8) {
                if let winner {
                    Label(winner.isMe ? NextlineCopy.youWon(standings.first?.score ?? 0) : NextlineCopy.won(winner.firstName), systemImage: "trophy.fill")
                        .font(.fbName)
                        .foregroundStyle(QuizNightStyle.violet)
                }
                if standings.isEmpty {
                    Text(NextlineCopy.pitch)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(Array(standings.prefix(3).enumerated()), id: \.offset) { index, row in
                        QuizNightStandingRow(rank: index + 1, user: row.user, score: row.score, highlight: row.user.isMe)
                    }
                }
                actions(bubble: bubble)
            }
            .padding(12)
        }
        .frame(width: placement.isFromMeOrChat ? 264 : nil)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(FBColor.divider, lineWidth: 1)
        )
        .padding(placement.isPostPlacement ? EdgeInsets(top: 0, leading: FBMetrics.gutter, bottom: 8, trailing: FBMetrics.gutter) : EdgeInsets())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.headline)
        .sheet(isPresented: $showsPodium) {
            NavigationStack {
                if let nightID {
                    QuizNightPodiumView(nightID: nightID)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button(NextlineCopy.closeLabel) { showsPodium = false }
                            }
                        }
                }
            }
        }
    }

    @ViewBuilder
    private func actions(bubble: Bubble?) -> some View {
        let played = night?.myScore != nil || card.extras["winner_id"] != nil
        if played, night != nil {
            Button {
                Haptics.light()
                showsPodium = true
            } label: {
                Label(NextlineCopy.seeResults, systemImage: "trophy")
            }
            .buttonStyle(.fb(.tinted, height: 36))
        } else {
            Button {
                Haptics.light()
                if let night {
                    center.play(night.id, router: router)
                } else {
                    BubbleSocialHub.play(card, router: router, context: BubblePlayContext(kind: .gameNight, id: nightID ?? card.id, cardID: card.id, opponentName: card.extras["place_name"]?.string))
                }
            } label: {
                Label(played ? NextlineCopy.playNow : NextlineCopy.join, systemImage: "play.fill")
            }
            .buttonStyle(.fb(.primary, height: 36))
            .disabled(bubble == nil)
        }
    }

    private struct Row {
        let user: User
        let score: Int
    }

    private func standingsFromCard() -> [Row] {
        (card.extras["standings"]?.array ?? []).compactMap { entry in
            guard let id = entry["user_id"]?.string, let score = entry["score"]?.int else { return nil }
            return Row(user: bubbleStore.resolvePerson(id), score: score)
        }
    }
}

private extension BubbleChatCardPlacement {
    var isPostPlacement: Bool {
        if case .post = self { return true }
        return false
    }

    var isFromMeOrChat: Bool { !isPostPlacement }
}

// MARK: - Place picker ("Start a quiz night in…")

/// Your Groups and group chats, for starting a quiz night with a Bubble.
struct QuizNightPlacePicker: View {
    let bubble: Bubble
    let onPick: (String) -> Void

    @Environment(AppStore.self) private var appStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(groups, id: \.id) { group in
                        row(title: group.name, subtitle: group.privacyText, symbol: "person.3.fill") { onPick(group.id) }
                    }
                } header: {
                    Text(NextlineCopy.groups)
                }
                if !chats.isEmpty {
                    Section {
                        ForEach(chats, id: \.id) { chat in
                            row(title: chat.title, subtitle: chat.participants.map(\.firstName).prefix(4).joined(separator: ", "), symbol: "bubble.left.and.bubble.right.fill") { onPick(chat.id) }
                        }
                    } header: {
                        Text(NextlineCopy.chats)
                    }
                }
            }
            .navigationTitle(NextlineCopy.startIn)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(NextlineCopy.closeLabel) { dismiss() }
                }
            }
        }
    }

    private var groups: [FBGroup] {
        appStore.myGroups.sorted { a, b in (a.id == BubbleDemo.groupID ? 0 : 1) < (b.id == BubbleDemo.groupID ? 0 : 1) }
    }

    private var chats: [Conversation] {
        appStore.conversations.filter { $0.isGroup && !$0.isArchived }
    }

    private func row(title: String, subtitle: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 36, height: 36)
                    .background(QuizNightStyle.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                    .foregroundStyle(FBColor.tertiaryText)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(NextlineCopy.startIn) \(title)")
    }
}
