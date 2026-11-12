import SwiftUI

/// A quiz night's podium (`BubbleFeatureRoute(.nextline, "podium", nightID)`): the top three, your
/// place, everyone round by round (who got it and how fast), Add friend for people you just met,
/// and Rematch.
struct QuizNightPodiumView: View {
    let nightID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    private var center: QuizNightCenter { QuizNightCenter.shared }

    var body: some View {
        Group {
            if let night = center.night(id: nightID) {
                content(night)
            } else {
                ContentUnavailableView(NextlineCopy.quizNight, systemImage: BubbleCategory.party.symbol, description: Text(NextlineCopy.notFound))
            }
        }
        .background(FBColor.background)
        .navigationTitle(NextlineCopy.podiumTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ night: QuizNight) -> some View {
        let rows = night.standings(me: appStore.me)
        let bubble = bubbleStore.bubble(id: night.bubbleID)
        return ScrollView {
            VStack(spacing: 12) {
                VStack(spacing: 14) {
                    HStack {
                        QuizNightChip()
                        Spacer(minLength: 0)
                        Text(NextlineCopy.inPlace(night.place.name))
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(Color.white.opacity(0.9))
                            .lineLimit(1)
                    }
                    Text(bubble?.title ?? NextlineCopy.quizNight)
                        .font(.fbTitle)
                        .foregroundStyle(Color.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    QuizNightPodium(rows: Array(rows.prefix(3)))
                    if let rank = rows.firstIndex(where: { $0.user.isMe }) {
                        Text(rank == 0 ? NextlineCopy.youWon(rows[0].score) : NextlineCopy.placed(rank + 1, of: rows.count))
                            .font(.fbHeadline)
                            .foregroundStyle(Color.white)
                    }
                }
                .padding(16)
                .background(QuizNightStyle.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
                .padding(.horizontal, FBMetrics.gutter)

                actions(night)

                card {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            HStack(spacing: 6) {
                                QuizNightStandingRow(rank: index + 1, user: row.user, score: row.score, detail: NextlineCopy.rightCount(row.right, night.rounds), highlight: row.user.isMe)
                                QuizNightAddFriendButton(user: row.user, bubbleID: night.bubbleID)
                            }
                        }
                        ForEach(night.joined.filter { !$0.isDone }) { member in
                            QuizNightStandingRow(rank: rows.count + 1, user: member.user, score: nil)
                        }
                    }
                }

                card {
                    QuizNightRoundGrid(night: night, me: appStore.me)
                }

                if night.isStaged {
                    Text(NextlineCopy.staged)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(.horizontal, FBMetrics.screenPadding)
                }
            }
            .padding(.vertical, 12)
        }
    }

    private func actions(_ night: QuizNight) -> some View {
        HStack(spacing: 8) {
            if night.myScore == nil && !night.isStaged {
                Button {
                    Haptics.light()
                    center.play(night.id, router: router)
                } label: {
                    Label(NextlineCopy.playNow, systemImage: "play.fill")
                }
                .buttonStyle(.fb(.primary, height: 40))
            } else {
                Button {
                    Haptics.medium()
                    center.rematch(night.id, router: router, appStore: appStore, bubbleStore: bubbleStore)
                } label: {
                    Label(NextlineCopy.rematch, systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.fb(.primary, height: 40))
            }
        }
        .padding(.horizontal, FBMetrics.gutter)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .padding(.horizontal, FBMetrics.gutter)
    }
}

/// Second, first, third on steps.
struct QuizNightPodium: View {
    let rows: [QuizNight.Standing]

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(order, id: \.self) { index in
                if index < rows.count {
                    step(rows[index], place: index + 1)
                } else {
                    Color.clear.frame(maxWidth: .infinity)
                }
            }
        }
        .frame(height: 210)
    }

    private var order: [Int] { [1, 0, 2] }

    private func step(_ row: QuizNight.Standing, place: Int) -> some View {
        let height: CGFloat = place == 1 ? 92 : place == 2 ? 66 : 48
        return VStack(spacing: 6) {
            if place == 1 {
                Image(systemName: "crown.fill")
                    .font(.system(size: FBIconSize.large, weight: .bold))
                    .foregroundStyle(Color.white)
                    .accessibilityHidden(true)
            }
            AvatarView(user: row.user, size: place == 1 ? FBAvatarSize.row : FBAvatarSize.compact)
                .overlay(Circle().strokeBorder(Color.white, lineWidth: 3))
            Text(row.user.isMe ? NextlineCopy.you : row.user.firstName)
                .font(.fbName)
                .foregroundStyle(Color.white)
                .lineLimit(1)
            Text(row.score.withCommas)
                .font(.fbMetaEmphasized)
                .monospacedDigit()
                .foregroundStyle(Color.white.opacity(0.9))
            Text("\(place)")
                .font(.system(size: FBIconSize.xl, weight: .heavy, design: .rounded))
                .foregroundStyle(QuizNightStyle.deep)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background(Color.white.opacity(place == 1 ? 0.92 : 0.7), in: UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10))
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(NextlineCopy.standingLabel(place, row.user.isMe ? NextlineCopy.you : row.user.firstName, row.score))
    }
}

/// Everyone, round by round: right or wrong and how fast.
struct QuizNightRoundGrid: View {
    let night: QuizNight
    let me: User

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(NextlineCopy.rounds)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            Grid(alignment: .leading, horizontalSpacing: 6, verticalSpacing: 8) {
                GridRow {
                    Color.clear.frame(width: 1, height: 1)
                    ForEach(0..<night.rounds, id: \.self) { k in
                        Text("\(k + 1)")
                            .font(.fbMicroEmphasized)
                            .foregroundStyle(FBColor.secondaryText)
                            .frame(maxWidth: .infinity)
                    }
                }
                ForEach(people, id: \.user.id) { person in
                    GridRow {
                        HStack(spacing: 6) {
                            AvatarView(user: person.user, size: FBAvatarSize.tiny)
                            Text(person.user.isMe ? NextlineCopy.you : person.user.firstName)
                                .font(.fbMetaEmphasized)
                                .foregroundStyle(FBColor.primaryText)
                                .lineLimit(1)
                        }
                        ForEach(0..<night.rounds, id: \.self) { k in
                            cell(person.rounds.first { $0.index == k })
                        }
                    }
                }
            }
        }
    }

    private struct Person {
        let user: User
        let rounds: [QuizRound]
    }

    private var people: [Person] {
        var out = [Person(user: me, rounds: night.myRounds)]
        out += night.joined.map { Person(user: $0.user, rounds: $0.rounds) }
        return out
    }

    @ViewBuilder
    private func cell(_ round: QuizRound?) -> some View {
        if let round {
            VStack(spacing: 1) {
                Image(systemName: round.correct ? "checkmark.circle.fill" : "xmark.circle")
                    .font(.system(size: FBIconSize.small, weight: .bold))
                    .foregroundStyle(round.correct ? QuizNightStyle.blue : FBColor.tertiaryText)
                Text(NextlineCopy.secondsShort(round.seconds))
                    .font(.fbMicro)
                    .monospacedDigit()
                    .foregroundStyle(FBColor.secondaryText)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(round.correct ? NextlineCopy.right : NextlineCopy.wrong), \(NextlineCopy.secondsShort(round.seconds))")
        } else {
            Text("–")
                .font(.fbMeta)
                .foregroundStyle(FBColor.tertiaryText)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(NextlineCopy.playing)
        }
    }
}

/// "Add friend" for someone you just played with (Maya isn't your friend yet in the demo).
struct QuizNightAddFriendButton: View {
    let user: User
    let bubbleID: String

    @Environment(AppStore.self) private var appStore

    var body: some View {
        if !user.isMe && user.friendship != .friends {
            let requested = user.friendship == .requestSent
            Button {
                Haptics.light()
                guard !requested else { return }
                appStore.sendRequest(to: user)
                BubbleSocialSignals.post(.addFriendFromGame, bubbleID: bubbleID, with: [user.id])
            } label: {
                Label(requested ? NextlineCopy.requested : NextlineCopy.addFriend, systemImage: requested ? "person.badge.clock" : "person.badge.plus")
                    .labelStyle(.iconOnly)
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .background(requested ? FBColor.buttonGray : FBColor.tintedBlueBackground, in: Circle())
                    .foregroundStyle(requested ? FBColor.secondaryText : FBColor.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(requested ? "\(NextlineCopy.requested): \(user.firstName)" : "\(NextlineCopy.addFriend): \(user.firstName)")
        }
    }
}

/// `results/<bubbleID>`: the latest finished night on that Bubble.
struct QuizNightResultsLookup: View {
    let bubbleID: String

    var body: some View {
        let night = QuizNightCenter.shared.nights.filter { $0.bubbleID == bubbleID && $0.phase == .finished }.max { $0.createdAt < $1.createdAt }
        if let night {
            QuizNightPodiumView(nightID: night.id)
        } else {
            ContentUnavailableView(NextlineCopy.quizNight, systemImage: BubbleCategory.party.symbol, description: Text(NextlineCopy.noNightsYet))
                .background(FBColor.background)
        }
    }
}
