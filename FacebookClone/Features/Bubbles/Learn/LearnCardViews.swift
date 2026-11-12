import SwiftUI

/// A shared lesson in a chat or a Group post (`BubbleChatCard.kind == .lesson`, docs/BUBBLES.md
/// 7.8): the cover, the topic, who learned it and how well, the Group meter ("New in SF knows 82%
/// of the hills") and Learn it, which plays the card's seed.
struct LearnLessonCardView: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                Group {
                    if let bubble {
                        BubbleCoverView(bubble: bubble, showsEmoji: true)
                    } else {
                        LearnStyle.gradient
                    }
                }
                .frame(height: 112)
                .frame(maxWidth: .infinity)
                .clipped()
                HStack(spacing: 4) {
                    Image(systemName: "graduationcap.fill")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                    Text(LearnCopy.lessonCardLabel)
                        .font(.fbCaptionEmphasized)
                    if let topic = card.extras[LearnShare.topicKey]?.string {
                        Text("· \(topic)")
                            .font(.fbCaption)
                            .lineLimit(1)
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.black.opacity(0.35), in: Capsule())
                .padding(8)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(card.headline)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                learners
                meter
                Button {
                    Haptics.light()
                    let sender = bubbleStore.resolvePerson(card.fromUserID)
                    BubbleSocialHub.play(card, router: router, context: BubblePlayContext(
                        kind: .lesson,
                        id: card.sessionID ?? card.id,
                        cardID: card.id,
                        opponentName: sender.isMe ? nil : sender.firstName
                    ))
                } label: {
                    Label(LearnCopy.learnIt, systemImage: "graduationcap.fill")
                }
                .buttonStyle(.fb(.primary, height: 36))
                .disabled(bubble == nil)
                .accessibilityLabel("\(LearnCopy.learnIt): \(bubble?.title ?? card.headline)")
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
        .accessibilityLabel(card.headline)
    }

    private var isPost: Bool {
        if case .post = placement { return true }
        return false
    }

    /// Avatars of everyone who learned it from this card, with their mastery.
    @ViewBuilder
    private var learners: some View {
        let entries = (card.extras[LearnShare.learnersKey]?.object ?? [:])
            .compactMap { id, value -> (User, String)? in
                guard let text = value.string else { return nil }
                return (bubbleStore.resolvePerson(id), text)
            }
            .sorted { a, b in a.0.isMe != b.0.isMe ? a.0.isMe : a.0.firstName < b.0.firstName }
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                FlowLayout(spacing: 6) {
                    ForEach(entries, id: \.0.id) { user, text in
                        HStack(spacing: 4) {
                            AvatarView(user: user, size: 20)
                            Text("\(user.isMe ? LearnCopy.you : user.firstName) \(text)")
                                .font(.fbCaptionEmphasized)
                                .foregroundStyle(FBColor.primaryText)
                                .monospacedDigit()
                        }
                        .padding(.leading, 2)
                        .padding(.trailing, 8)
                        .padding(.vertical, 2)
                        .background(LearnStyle.tint, in: Capsule())
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(user.isMe ? LearnCopy.you : user.name): \(LearnCopy.masteryLine(text))")
                    }
                }
                let names = entries.filter { !$0.0.isMe }.map { $0.0.firstName }
                if !names.isEmpty {
                    Text(LearnCopy.learnedBy(names))
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
        }
    }

    @ViewBuilder
    private var meter: some View {
        if let value = card.extras[LearnShare.groupMasteryKey]?.double, let group = card.extras[LearnShare.groupNameKey]?.string {
            let subject = card.extras[LearnShare.subjectKey]?.string ?? card.extras[LearnShare.topicKey]?.string ?? ""
            VStack(alignment: .leading, spacing: 4) {
                Text(LearnCopy.groupKnows(group, percent: Int((value * 100).rounded()), subject: subject))
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                LearnMeterBar(value: value, height: 8)
            }
            .accessibilityElement(children: .combine)
        }
    }
}
