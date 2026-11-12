import SwiftUI

// Slot views for the "nextline" feature (docs/BUBBLES.md 7.7). Owner: nextline.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift.

/// Quiz night podium on the result sheet: where you placed, the others, Rematch.
struct NextlineResultSummary: View {
    let slot: BubbleResultSlotContext

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        if let play = slot.play, play.kind == .gameNight, let night = QuizNightCenter.shared.night(id: play.id) {
            summary(night)
        }
    }

    private func summary(_ night: QuizNight) -> some View {
        let rows = night.standings(me: appStore.me)
        let rank = rows.firstIndex { $0.user.isMe }
        let pending = night.joined.filter { !$0.isDone }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                QuizNightChip()
                Spacer(minLength: 0)
                Text(NextlineCopy.inPlace(night.place.name))
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(Color.white.opacity(0.9))
                    .lineLimit(1)
            }
            if let rank {
                Text(rank == 0 ? NextlineCopy.youWon(rows[0].score) : NextlineCopy.placed(rank + 1, of: rows.count + pending.count))
                    .font(.fbHeadline)
                    .foregroundStyle(Color.white)
            }
            VStack(spacing: 4) {
                ForEach(Array(rows.prefix(4).enumerated()), id: \.element.id) { index, row in
                    QuizNightStandingRow(rank: index + 1, user: row.user, score: row.score, detail: NextlineCopy.rightCount(row.right, night.rounds), highlight: row.user.isMe)
                }
                ForEach(pending) { member in
                    QuizNightStandingRow(rank: rows.count + 1, user: member.user, score: nil)
                }
            }
            .padding(6)
            .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            HStack(spacing: 8) {
                Button {
                    Haptics.light()
                    let id = night.id
                    slot.leavingPlayer {
                        router.push(.bubbleFeature(BubbleFeatureRoute(.nextline, "podium", id)))
                    }
                } label: {
                    Label(NextlineCopy.fullResults, systemImage: "trophy")
                }
                .buttonStyle(.fb(.secondary, height: 40))
                Button {
                    Haptics.medium()
                    let id = night.id
                    slot.leavingPlayer {
                        QuizNightCenter.shared.rematch(id, router: router, appStore: appStore, bubbleStore: bubbleStore)
                    }
                } label: {
                    Label(NextlineCopy.rematch, systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.fb(.primary, height: 40))
            }
        }
        .padding(14)
        .background(QuizNightStyle.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// 'Start a quiz night in…' on a quiz night Bubble's page.
struct NextlineDetailRow: View {
    let bubble: Bubble

    @Environment(Router.self) private var router
    @State private var picking = false

    var body: some View {
        if bubble.formula == .nextline {
            Button {
                Haptics.light()
                picking = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: BubbleCategory.party.symbol)
                        .font(.system(size: FBIconSize.large, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .frame(width: 44, height: 44)
                        .background(QuizNightStyle.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(NextlineCopy.startIn)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Text(NextlineCopy.startInDetail)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                        .foregroundStyle(FBColor.tertiaryText)
                }
                .padding(12)
                .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).strokeBorder(FBColor.divider, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 6)
            .accessibilityLabel(NextlineCopy.startIn)
            .sheet(isPresented: $picking) {
                QuizNightPlacePicker(bubble: bubble) { placeID in
                    QuizNightCenter.shared.preferredBubble[placeID] = bubble.id
                    picking = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        router.push(.bubbleFeature(BubbleFeatureRoute(.nextline, "night", placeID)))
                    }
                }
                .presentationDetents([.medium, .large])
            }
        }
    }
}

/// The live strip during a quiz night: members light up as they answer this round (from their
/// real bot runs, paced to your clock), and a mini leaderboard between rounds.
struct NextlinePlayerBanner: View {
    let bubble: Bubble
    let request: BubblePlayRequest
    let score: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Estimated start of your run (the intro card waits for your first tap).
    @State private var anchor: Date?
    /// Seconds you took per round, learned when your score jumps (a right answer).
    @State private var mine: [Int: Double] = [:]

    var body: some View {
        if let context = request.context, context.kind == .gameNight, let night = QuizNightCenter.shared.night(id: context.id) {
            let timeline = QuizTimeline(manifest: request.effectiveManifest(bubble.manifest), rounds: night.rounds)
            TimelineView(.periodic(from: .now, by: 0.25)) { tick in
                strip(night, timeline: timeline, now: tick.date)
            }
            .onAppear {
                if anchor == nil { anchor = Date().addingTimeInterval(1.8) }
            }
            .onChange(of: score) { old, new in
                resync(old: old, new: new, timeline: timeline)
            }
        }
    }

    private static let defaultAnswer = 3.0

    private func myBeats(_ timeline: QuizTimeline) -> [QuizTimeline.Beat] {
        timeline.beats { mine[$0] ?? Self.defaultAnswer }
    }

    /// A right answer moves the score: pin that round's answer time, so the strip follows you.
    private func resync(old: Int, new: Int, timeline: QuizTimeline) {
        if new == 0 {
            // Play again restarted the run.
            anchor = Date().addingTimeInterval(0.6)
            mine = [:]
            return
        }
        guard new > old, let anchor else { return }
        let t = Date().timeIntervalSince(anchor)
        let beats = myBeats(timeline)
        if let first = beats.first, t < first.freeze {
            // You tapped through the scene faster than the estimate: start the clock earlier.
            self.anchor = Date().addingTimeInterval(-(first.freeze + 1))
            mine[0] = 1
            return
        }
        let k = beats.lastIndex { $0.freeze <= t + 0.3 } ?? 0
        mine[k] = max(0.2, t - beats[k].freeze)
    }

    @ViewBuilder
    private func strip(_ night: QuizNight, timeline: QuizTimeline, now: Date) -> some View {
        let t = anchor.map { now.timeIntervalSince($0) } ?? -1
        let beats = myBeats(timeline)
        let k = max(0, min(beats.count - 1, beats.lastIndex { $0.start <= t } ?? 0))
        let beat = beats[k]
        let between = t >= beat.answer && t < beat.end
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(NextlineCopy.quizNight)
                    .font(.fbMicroEmphasized)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.white.opacity(0.8))
                Text(between ? NextlineCopy.afterRound(k + 1) : NextlineCopy.roundOf(k + 1, night.rounds))
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
            }
            .fixedSize()
            if between {
                leaderboard(night, round: k, t: t, timeline: timeline)
            } else {
                avatars(night, round: k, t: t, timeline: timeline)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.34), in: Capsule())
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: between)
        .padding(.horizontal, 12)
        .accessibilityElement(children: .contain)
    }

    private func memberBeats(_ member: QuizNightMember, _ timeline: QuizTimeline) -> [QuizTimeline.Beat] {
        timeline.beats { k in member.rounds.first { $0.index == k }?.seconds ?? timeline.timer }
    }

    private func avatars(_ night: QuizNight, round k: Int, t: Double, timeline: QuizTimeline) -> some View {
        HStack(spacing: 8) {
            ForEach(night.joined) { member in
                let result = member.rounds.first { $0.index == k }
                let beats = memberBeats(member, timeline)
                let answered = result != nil && k < beats.count && t >= beats[k].answer
                let thinking = !answered && k < beats.count && t >= beats[k].freeze
                VStack(spacing: 1) {
                    AvatarView(user: member.user, size: 26)
                        .opacity(answered || thinking ? 1 : 0.55)
                        .overlay(alignment: .bottomTrailing) {
                            badge(answered: answered, correct: result?.correct ?? false, thinking: thinking)
                                .offset(x: 4, y: 3)
                        }
                    Text(answered ? NextlineCopy.secondsShort(result?.seconds ?? 0) : member.user.firstName)
                        .font(.fbMicroEmphasized)
                        .monospacedDigit()
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(Color.white.opacity(0.9))
                        .lineLimit(1)
                }
                .frame(width: 38)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(answered ? NextlineCopy.memberAnswered(member.user.firstName, correct: result?.correct ?? false, seconds: result?.seconds ?? 0) : NextlineCopy.memberWaiting(member.user.firstName))
            }
        }
    }

    @ViewBuilder
    private func badge(answered: Bool, correct: Bool, thinking: Bool) -> some View {
        if answered {
            Image(systemName: correct ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: FBIconSize.xs, weight: .bold))
                .foregroundStyle(Color.white, correct ? QuizNightStyle.blue : Color.gray)
                .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
        } else if thinking {
            Image(systemName: "ellipsis.circle.fill")
                .font(.system(size: FBIconSize.xs, weight: .bold))
                .foregroundStyle(Color.white, QuizNightStyle.violet)
        }
    }

    /// Everyone's points through round k, plus your live score.
    private func leaderboard(_ night: QuizNight, round k: Int, t: Double, timeline: QuizTimeline) -> some View {
        var rows: [(name: String, score: Int, isMe: Bool)] = night.joined.map { member in
            let points = member.rounds.filter { $0.index <= k }.reduce(0) { $0 + $1.points }
            return (member.user.firstName, points, false)
        }
        rows.append((NextlineCopy.you, score, true))
        rows.sort { $0.score != $1.score ? $0.score > $1.score : $0.isMe }
        return HStack(spacing: 6) {
            ForEach(Array(rows.prefix(4).enumerated()), id: \.offset) { index, row in
                HStack(spacing: 3) {
                    Text("\(index + 1)")
                        .font(.fbMicroEmphasized)
                        .foregroundStyle(Color.white.opacity(0.7))
                    Text(row.name)
                        .font(.fbMicroEmphasized)
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                    Text(row.score.withCommas)
                        .font(.fbMicro)
                        .monospacedDigit()
                        .foregroundStyle(Color.white.opacity(0.85))
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(row.isMe ? QuizNightStyle.blue.opacity(0.85) : Color.white.opacity(0.14), in: Capsule())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(NextlineCopy.standingLabel(index + 1, row.name, row.score))
            }
        }
        .transition(.opacity)
    }
}

/// Quiz night card on the Group's Games tab: start one, the live night, or last night's winner.
struct NextlineGroupGameNight: View {
    let group: FBGroup

    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        let center = QuizNightCenter.shared
        let open = center.openNight(at: group.id)
        let last = center.lastFinished(at: group.id)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text("🎬")
                    .font(.system(size: 30)) // Display glyph for the quiz night card
                    .frame(width: 52, height: 52)
                    .background(Color.white.opacity(0.2), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    QuizNightChip(live: open?.phase == .live)
                    Text(NextlineCopy.tagline)
                        .font(.fbHeadline)
                        .foregroundStyle(Color.white)
                    Text(NextlineCopy.pitch)
                        .font(.fbMeta)
                        .foregroundStyle(Color.white.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let open {
                avatarsRow(open.joined.map(\.user))
            } else if let last, let top = last.standings(me: appStore.me).first {
                Label(NextlineCopy.lastWinner(top.user.isMe ? NextlineCopy.you : top.user.firstName, top.score), systemImage: "trophy.fill")
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(Color.white)
            } else {
                Text(NextlineCopy.noNightsYet)
                    .font(.fbMeta)
                    .foregroundStyle(Color.white.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Haptics.light()
                router.push(.bubbleFeature(BubbleFeatureRoute(.nextline, "night", group.id)))
            } label: {
                Text(open == nil ? NextlineCopy.startOne : NextlineCopy.join)
                    .font(.fbButton)
                    .foregroundStyle(QuizNightStyle.deep)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .background(Color.white, in: Capsule())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("\(NextlineCopy.quizNight): \(open == nil ? NextlineCopy.startOne : NextlineCopy.join)")
        }
        .padding(14)
        .background(QuizNightStyle.gradient, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(12)
        .background(FBColor.surface)
        .accessibilityElement(children: .contain)
    }

    private func avatarsRow(_ users: [User]) -> some View {
        HStack(spacing: -8) {
            ForEach(users.prefix(5), id: \.id) { user in
                AvatarView(user: user, size: FBAvatarSize.reply)
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
            }
            Text(NextlineCopy.joinedCount(users.count + 1))
                .font(.fbMetaEmphasized)
                .foregroundStyle(Color.white)
                .padding(.leading, 14)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(NextlineCopy.joinedCount(users.count + 1))
    }
}

/// 'Quiz night tonight · 4 joined' in the Featured tab, when a night is on.
struct NextlineFeaturedBanner: View {
    let group: FBGroup

    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        if let night = QuizNightCenter.shared.latestNight(at: group.id) {
            Button {
                Haptics.light()
                if night.phase == .finished {
                    router.push(.bubbleFeature(BubbleFeatureRoute(.nextline, "podium", night.id)))
                } else {
                    router.push(.bubbleFeature(BubbleFeatureRoute(.nextline, "night", group.id)))
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: night.phase == .live ? "dot.radiowaves.left.and.right" : BubbleCategory.party.symbol)
                        .font(.system(size: FBIconSize.medium, weight: .bold))
                        .foregroundStyle(Color.white)
                    Text(bannerText(night))
                        .font(.fbName)
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Text(night.phase == .finished ? NextlineCopy.seeResults : NextlineCopy.join)
                        .font(.fbButton)
                        .foregroundStyle(QuizNightStyle.deep)
                        .padding(.horizontal, 12)
                        .frame(height: 30)
                        .background(Color.white, in: Capsule())
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(QuizNightStyle.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            }
            .buttonStyle(.pressable)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(FBColor.surface)
            .accessibilityLabel(bannerText(night))
        }
    }

    /// 'Quiz night tonight · 4 joined' while a night is open; the winner once it's over.
    private func bannerText(_ night: QuizNight) -> String {
        if night.phase == .finished, let top = night.standings(me: appStore.me).first {
            return NextlineCopy.lastWinner(top.user.isMe ? NextlineCopy.you : top.user.firstName, top.score)
        }
        return NextlineCopy.tonight(night.joined.count + 1)
    }
}

/// Game night cards in chats and Group posts.
struct NextlineCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        if card.kind == .gameNight {
            QuizNightCard(card: card, placement: placement)
        } else {
            BubbleChatCardFallback(card: card, placement: placement)
        }
    }
}
