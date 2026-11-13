import SwiftUI

/// The quiz night lobby in a Group or group chat (`BubbleFeatureRoute(.nextline, "night", placeID)`):
/// pick the scenes, watch people join, Start. Starting posts a game night card to the Group or chat
/// and opens the player on the night's seed. After the night it shows the podium and Rematch.
struct QuizNightLobbyView: View {
    let placeID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var nightID: String?

    private var center: QuizNightCenter { QuizNightCenter.shared }
    private var night: QuizNight? { nightID.flatMap { center.night(id: $0) } }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let night {
                    header(night)
                    switch night.phase {
                    case .lobby:
                        scenes(night)
                        people(night)
                        startButton(night)
                    case .live:
                        people(night)
                        liveCard(night)
                    case .finished:
                        finishedCard(night)
                    }
                    howItWorks
                } else {
                    empty
                }
            }
            .padding(.vertical, 12)
        }
        .background(FBColor.background)
        .navigationTitle(NextlineCopy.quizNight)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: open)
    }

    private func open() {
        if let current = nightID, center.night(id: current) != nil { return }
        // A live night keeps going; otherwise reuse or create the lobby (which also applies a
        // Bubble picked on its page with "Start a quiz night in…").
        if let live = center.openNight(at: placeID), live.phase == .live {
            nightID = live.id
            return
        }
        nightID = center.openLobby(at: placeID, appStore: appStore, bubbleStore: bubbleStore)?.id
            ?? center.latestNight(at: placeID)?.id
    }

    // MARK: Sections

    private func header(_ night: QuizNight) -> some View {
        let bubble = bubbleStore.bubble(id: night.bubbleID)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                QuizNightChip(live: night.phase == .live)
                Spacer(minLength: 0)
                if bubble?.isMadeWithMuse == true { MuseBadge(compact: true) }
            }
            Text(NextlineCopy.tagline)
                .font(.fbTitle)
                .foregroundStyle(Color.white)
            Text(NextlineCopy.inPlace(night.place.name))
                .font(.fbName)
                .foregroundStyle(Color.white.opacity(0.9))
            Text(NextlineCopy.pitch)
                .font(.fbBody)
                .foregroundStyle(Color.white.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GameColor.accentGradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
        .padding(.horizontal, FBMetrics.gutter)
        .accessibilityElement(children: .combine)
    }

    private func scenes(_ night: QuizNight) -> some View {
        let sets = center.episodeSets(for: night.place.id, bubbleStore: bubbleStore)
        return section(NextlineCopy.pickScenes) {
            if sets.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text(NextlineCopy.noScenes)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                    museButton(night)
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(sets, id: \.id) { bubble in
                            sceneTile(bubble, selected: bubble.id == night.bubbleID) {
                                Haptics.selection()
                                center.choose(bubbleID: bubble.id, for: night.id, bubbleStore: bubbleStore)
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func sceneTile(_ bubble: Bubble, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                BubbleCoverView(bubble: bubble)
                    .frame(width: 124, height: 92)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .overlay(alignment: .topTrailing) {
                        if selected {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: FBIconSize.large, weight: .bold))
                                .foregroundStyle(Color.white, QuizNightStyle.blue)
                                .padding(6)
                        }
                    }
                    .overlay(
                        RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                            .strokeBorder(selected ? QuizNightStyle.blue : FBColor.divider, lineWidth: selected ? 3 : 1)
                    )
                Text(bubble.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text("\(NextlineCopy.roundsLabel(QuizNightCenter.rounds(in: bubble))) · \(bubble.creator.isMe ? NextlineCopy.you : bubble.creator.firstName)")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            .frame(width: 124)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(bubble.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func people(_ night: QuizNight) -> some View {
        section(NextlineCopy.whosHere) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 8)], spacing: 12) {
                personCell(appStore.me, joined: true, done: night.myScore != nil)
                ForEach(night.members) { member in
                    personCell(member.user, joined: member.hasJoined, done: night.phase != .lobby && member.isDone)
                }
            }
            .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.7), value: night.joined.count)
        }
    }

    private func personCell(_ user: User, joined: Bool, done: Bool) -> some View {
        VStack(spacing: 6) {
            AvatarView(user: user, size: FBAvatarSize.compact)
                .opacity(joined ? 1 : 0.35)
                .scaleEffect(joined || reduceMotion ? 1 : 0.86)
                .overlay(alignment: .bottomTrailing) {
                    if joined {
                        Image(systemName: done ? "flag.checkered.circle.fill" : "checkmark.circle.fill")
                            .font(.system(size: FBIconSize.regular, weight: .bold))
                            .foregroundStyle(Color.white, QuizNightStyle.blue)
                            .background(Circle().fill(FBColor.surface).padding(1))
                            .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
                    }
                }
            Text(user.isMe ? NextlineCopy.you : user.firstName)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            Text(joined ? (done ? NextlineCopy.done : NextlineCopy.joined) : NextlineCopy.waiting)
                .font(.fbMicro)
                .foregroundStyle(FBColor.secondaryText)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(user.isMe ? NextlineCopy.you : user.firstName), \(joined ? (done ? NextlineCopy.done : NextlineCopy.joined) : NextlineCopy.waiting)")
    }

    private func startButton(_ night: QuizNight) -> some View {
        let bubble = bubbleStore.bubble(id: night.bubbleID)
        return VStack(spacing: 8) {
            Button {
                Haptics.medium()
                center.start(night.id, router: router, appStore: appStore, bubbleStore: bubbleStore)
            } label: {
                Label(NextlineCopy.start, systemImage: "play.fill")
            }
            .buttonStyle(.fb(.primary, height: 44))
            .disabled(bubble == nil)
            .accessibilityLabel(NextlineCopy.startLabel(bubble?.title ?? ""))
            Text("\(bubble?.title ?? "") · \(NextlineCopy.roundsLabel(night.rounds)) · \(NextlineCopy.joinedCount(night.joined.count + 1))")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .padding(.horizontal, FBMetrics.screenPadding)
    }

    private func liveCard(_ night: QuizNight) -> some View {
        section(NextlineCopy.liveNow) {
            VStack(spacing: 10) {
                ForEach(Array(night.standings(me: appStore.me).enumerated()), id: \.element.id) { index, row in
                    QuizNightStandingRow(rank: index + 1, user: row.user, score: row.score, detail: NextlineCopy.rightCount(row.right, night.rounds), highlight: row.user.isMe)
                }
                Button {
                    Haptics.light()
                    center.play(night.id, router: router)
                } label: {
                    Label(NextlineCopy.playNow, systemImage: "play.fill")
                }
                .buttonStyle(.fb(.primary, height: 40))
            }
        }
    }

    private func finishedCard(_ night: QuizNight) -> some View {
        let rows = night.standings(me: appStore.me)
        return section(NextlineCopy.podiumTitle) {
            VStack(spacing: 10) {
                ForEach(Array(rows.prefix(4).enumerated()), id: \.element.id) { index, row in
                    QuizNightStandingRow(rank: index + 1, user: row.user, score: row.score, detail: NextlineCopy.rightCount(row.right, night.rounds), highlight: row.user.isMe)
                }
                ForEach(night.joined.filter { !$0.isDone }) { member in
                    QuizNightStandingRow(rank: rows.count + 1, user: member.user, score: nil)
                }
                HStack(spacing: 8) {
                    Button {
                        Haptics.light()
                        router.push(.bubbleFeature(BubbleFeatureRoute(.nextline, "podium", night.id)))
                    } label: {
                        Label(NextlineCopy.fullResults, systemImage: "trophy")
                    }
                    .buttonStyle(.fb(.secondary, height: 40))
                    Button {
                        Haptics.medium()
                        if let next = center.rematch(night.id, router: router, appStore: appStore, bubbleStore: bubbleStore) {
                            nightID = next
                        }
                    } label: {
                        Label(NextlineCopy.rematch, systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.fb(.primary, height: 40))
                }
            }
        }
    }

    private var howItWorks: some View {
        section(nil) {
            VStack(alignment: .leading, spacing: 10) {
                step("theatermasks.fill", NextlineCopy.howScene)
                step("hand.tap.fill", NextlineCopy.howPick)
                step("trophy.fill", NextlineCopy.howPodium)
            }
        }
    }

    private func step(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.medium, weight: .semibold))
                .foregroundStyle(QuizNightStyle.violet)
                .frame(width: 24)
            Text(text)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var empty: some View {
        VStack(spacing: 14) {
            ContentUnavailableView(NextlineCopy.quizNight, systemImage: BubbleCategory.party.symbol, description: Text(NextlineCopy.noScenes))
            Button {
                router.openStudio(StudioLaunch(groupID: placeID.hasPrefix("group-") ? placeID : nil, prompt: NextlineCopy.museExample))
            } label: {
                Label(NextlineCopy.makeWithMuse, systemImage: "sparkles")
            }
            .buttonStyle(.fb(.primary, expand: false, height: 40))
        }
        .padding(.top, 40)
    }

    private func museButton(_ night: QuizNight) -> some View {
        Button {
            router.openStudio(StudioLaunch(groupID: night.place.kind == .group ? night.place.id : nil, prompt: NextlineCopy.museExample))
        } label: {
            Label(NextlineCopy.makeWithMuse, systemImage: "sparkles")
        }
        .buttonStyle(.fb(.tinted, expand: false, height: 36))
    }

    private func section<Content: View>(_ title: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
            }
            content()
        }
        .padding(FBMetrics.screenPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .padding(.horizontal, FBMetrics.gutter)
    }
}
