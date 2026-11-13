import SwiftUI

// Views for same-seed rounds (`RoundsCenter`, `/v1/rounds`). Everything shown comes from the
// server: who played, the result lines, the order and winner, or "% in sync" for opinion games.

// MARK: - Card

/// One round as a card: the game, who's in and who has played, the latest lines, and the next step.
struct RoundCardView: View {
    let round: RemoteRound
    /// Where it's played ("Bay Area Hikers", "You and Bob"); shown under the title.
    var placeName: String?
    /// Lines to show; nil shows them all.
    var lineLimit: Int? = 2

    @Environment(Router.self) private var router
    @State private var opening = false

    private var center: RoundsCenter { RoundsCenter.shared }
    private var meID: String? { center.meID }
    private var myTurn: Bool { !round.finished && !round.hasPlayed(meID) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            people
            if !round.lines.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(lineLimit.map { Array(round.lines.suffix($0)) } ?? round.lines) { line in
                        Text(line.text)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.primaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            RoundOutcomeLine(round: round)
            HStack(spacing: 8) {
                if myTurn {
                    Button {
                        Haptics.light()
                        opening = true
                        Task { @MainActor in
                            await center.play(round, placeName: placeName, router: router)
                            opening = false
                        }
                    } label: {
                        if opening || center.submitting.contains(round.id) {
                            ProgressView()
                        } else {
                            Label(RoundsCopy.play, systemImage: "play.fill")
                        }
                    }
                    .buttonStyle(.fb(.primary, height: 36))
                    .disabled(opening)
                }
                Button {
                    router.push(.bubbleFeature(BubbleFeatureRoute(.challenge, "round", round.id)))
                } label: {
                    Text(RoundsCopy.seeResults)
                }
                .buttonStyle(.fb(myTurn ? .secondary : .tinted, height: 36))
            }
        }
        .padding(12)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous)
                .fill(GameColor.accentGradient)
                .frame(width: 40, height: 40)
                .overlay {
                    Image(systemName: round.isOpinion ? "heart.text.square.fill" : "person.3.fill")
                        .foregroundStyle(.white)
                }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(round.game?.title ?? "A game")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text([placeName, round.finished ? RoundsCopy.finished : RoundsCopy.closes(round.closesAt)]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if myTurn {
                Text(RoundsCopy.yourTurn)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.accent)
            }
        }
    }

    private var people: some View {
        HStack(spacing: 6) {
            ForEach(round.members.prefix(8)) { member in
                if let user = center.person(member) {
                    AvatarView(user: user, size: FBAvatarSize.reply)
                        .opacity(round.hasPlayed(member.id) ? 1 : 0.4)
                        .overlay(alignment: .bottomTrailing) {
                            if round.hasPlayed(member.id) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(FBColor.online)
                                    .background(Circle().fill(FBColor.surface))
                            }
                        }
                        .accessibilityLabel("\(member.shownName), \(round.hasPlayed(member.id) ? "played" : "not played yet")")
                }
            }
            Spacer(minLength: 4)
            Text(RoundsCopy.played(round.playedCount, of: round.members.count))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
    }
}

/// The round's outcome in one line: the winner, a tie, or how in sync I am with each player.
struct RoundOutcomeLine: View {
    let round: RemoteRound

    var body: some View {
        let meID = RoundsCenter.shared.meID
        if round.isOpinion {
            if !round.agreement.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(round.agreement, id: \.userID) { a in
                        Label(RoundsCopy.inSyncWith(a.percent, round.member(a.userID)?.shownName ?? "them"), systemImage: "heart.fill")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.savedPurple)
                    }
                }
            }
        } else if round.finished {
            if let winner = round.winnerID {
                Label(winner == meID ? RoundsCopy.youWon : RoundsCopy.won(round.member(winner)?.shownName ?? "Someone"),
                      systemImage: "trophy.fill")
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.pollOrange)
            } else if round.playedCount > 1 {
                Label(RoundsCopy.tie, systemImage: "equal.circle.fill")
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
    }
}

// MARK: - Detail

/// `BubbleFeatureRoute(.challenge, "round", <roundID>)`: one round in full.
struct RoundDetailView: View {
    let roundID: String

    @Environment(Router.self) private var router
    @State private var failure: String?
    @State private var groupAgreement: RemoteGameAgreement?
    @State private var opening = false

    private var center: RoundsCenter { RoundsCenter.shared }

    var body: some View {
        Group {
            if let round = center.rounds[roundID] {
                content(round)
            } else if let failure {
                LiveDataStateView(kind: .failed(failure), title: "Couldn't load this round") { Task { await load() } }
            } else {
                LiveDataStateView(kind: .loading, title: "Loading the round…")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FBColor.background)
        .navigationTitle(center.rounds[roundID]?.game?.title ?? RoundsCopy.title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: roundID) {
            // Others play on their own phones: look again every few seconds while this is open.
            while !Task.isCancelled {
                await load()
                if center.rounds[roundID]?.finished == true { break }
                try? await Task.sleep(nanoseconds: 8_000_000_000)
            }
        }
    }

    private func load() async {
        do {
            let round = try await center.refresh(id: roundID)
            failure = nil
            if round.isOpinion, round.hasPlayed(center.meID), round.playedCount > 1, let gameID = round.game?.id {
                groupAgreement = try? await GamesAPIFactory.current.agreement(
                    gameID: gameID,
                    with: round.target?.kind == .chat && round.members.count == 2 ? round.members.first { $0.id != center.meID }?.id : nil,
                    scope: round.target?.kind == .group ? "group" : (round.members.count > 2 ? "friends" : nil),
                    groupID: round.target?.kind == .group ? round.target?.id : nil)
            }
        } catch {
            if center.rounds[roundID] == nil { failure = error.localizedDescription }
        }
    }

    @ViewBuilder
    private func content(_ round: RemoteRound) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(round.isOpinion ? RoundsCopy.opinionNote : RoundsCopy.startRoundDetail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    RoundOutcomeLine(round: round)
                    if !round.finished && !round.hasPlayed(center.meID) {
                        Button {
                            Haptics.light()
                            opening = true
                            Task { @MainActor in
                                await center.play(round, placeName: nil, router: router)
                                opening = false
                            }
                        } label: {
                            if opening || center.submitting.contains(round.id) { ProgressView() } else {
                                Label(RoundsCopy.play, systemImage: "play.fill")
                            }
                        }
                        .buttonStyle(.fb(.primary, height: 40))
                    }
                    Text(round.finished ? RoundsCopy.finished : RoundsCopy.closes(round.closesAt))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.tertiaryText)
                }
                .padding(.vertical, 4)
            }
            Section(round.isOpinion ? RoundsCopy.inSync : RoundsCopy.standings) {
                ForEach(rows(round), id: \.id) { member in
                    standingRow(member, round: round)
                }
            }
            if let groupAgreement {
                Section(RoundsCopy.groupInSync(groupAgreement.agreement, players: groupAgreement.players)) {
                    ForEach(groupAgreement.items, id: \.item) { item in
                        HStack {
                            Text(item.item)
                                .font(.fbMetaEmphasized)
                                .foregroundStyle(FBColor.primaryText)
                            Spacer(minLength: 8)
                            Text("You: \(item.mine) · Most: \(item.group)")
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                            Text("\(Int((item.share * 100).rounded()))%")
                                .font(.fbMetaEmphasized)
                                .foregroundStyle(FBColor.savedPurple)
                        }
                    }
                }
            }
            if !round.lines.isEmpty {
                Section(RoundsCopy.thread) {
                    ForEach(round.lines.reversed()) { line in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.text)
                                .font(.fbBody)
                                .foregroundStyle(FBColor.primaryText)
                            Text(line.at, style: .relative)
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.tertiaryText)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    /// Players in the server's order, then those still to play.
    private func rows(_ round: RemoteRound) -> [RemoteProfile] {
        let ranked = round.order.compactMap { round.member($0) }
        return ranked + round.members.filter { m in !round.order.contains(m.id) }
    }

    private func standingRow(_ member: RemoteProfile, round: RemoteRound) -> some View {
        let play = round.plays[member.id]
        let place = round.order.firstIndex(of: member.id).map { $0 + 1 }
        let isMe = member.id == center.meID
        let sync = round.agreement.first { $0.userID == member.id }
        return HStack(spacing: 12) {
            if !round.isOpinion {
                Text(place.map { "\($0)" } ?? "–")
                    .font(.fbHeadline)
                    .foregroundStyle(place == 1 ? FBColor.pollOrange : FBColor.secondaryText)
                    .frame(width: 22)
            }
            if let user = center.person(member) {
                AvatarView(user: user, size: FBAvatarSize.comment)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(isMe ? "You" : member.shownName)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                if let ending = play?.ending {
                    Text(ending)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Spacer(minLength: 8)
            if play?.played == true {
                if round.isOpinion {
                    if let sync {
                        Text("\(sync.percent)%")
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.savedPurple)
                    } else {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(FBColor.online)
                    }
                } else {
                    Text(play?.dnf == true ? "Didn't finish" : (play?.display ?? play?.score.map { "\($0)" } ?? ""))
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(member.id == round.winnerID ? FBColor.pollOrange : FBColor.primaryText)
                }
            } else {
                Text(RoundsCopy.waitingOn)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.tertiaryText)
            }
        }
        .frame(minHeight: 44)
    }
}

// MARK: - List at a place

/// The rounds in a Group or a chat, newest first, with Start a round. Also the quiz night screen
/// (`quiz: true`), which starts Group rounds on quiz games.
struct RoundsListView: View {
    let target: RoundTarget
    let placeName: String
    /// Chat rounds: the people in the chat besides you (server ids).
    var chatMembers: [String] = []
    var quiz = false

    @State private var picking = false

    private var center: RoundsCenter { RoundsCenter.shared }

    var body: some View {
        let rounds = center.list(target)
        ScrollView {
            VStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(quiz ? RoundsCopy.quizPitch : RoundsCopy.startRoundDetail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Button {
                        Haptics.light()
                        picking = true
                    } label: {
                        Label(quiz ? RoundsCopy.startQuiz : RoundsCopy.startRound, systemImage: quiz ? "questionmark.bubble.fill" : "person.3.fill")
                    }
                    .buttonStyle(.fb(.primary, height: 40))
                }
                .padding(12)
                .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))

                if rounds.isEmpty {
                    switch center.state(target) {
                    case .loading:
                        LiveDataStateView(kind: .loading, title: "Loading rounds…")
                    case .failed(let message):
                        LiveDataStateView(kind: .failed(message), title: "Couldn't load the rounds") { center.load(target) }
                    default:
                        LiveDataStateView(kind: .empty(RoundsCopy.noRoundsDetail), title: quiz ? RoundsCopy.noQuiz : RoundsCopy.noRounds)
                    }
                } else {
                    ForEach(rounds) { round in
                        RoundCardView(round: round, placeName: nil)
                    }
                }
            }
            .padding(12)
        }
        .background(FBColor.background)
        .navigationTitle(quiz ? RoundsCopy.quizNight : placeName)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { center.load(target, quiet: true) }
        .task(id: target) {
            center.load(target)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                center.load(target, quiet: true)
            }
        }
        .sheet(isPresented: $picking) {
            RoundGamePickerSheet(target: target, placeName: placeName, chatMembers: chatMembers, quiz: quiz)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

extension RoundsCopy {
    static let quizNight = "Quiz night"
    static let startQuiz = "Start a quiz night"
    static let noQuiz = "No quiz nights yet"
    static let quizPitch = "Everyone answers the same questions on the same seed, on their own time. The board fills in as people play."
}

// MARK: - Picking a game for a place

/// Pick the game for a new round at a Group or chat. The Group's own games come first; any game
/// Muse made works (the server checks every run by replaying it).
struct RoundGamePickerSheet: View {
    let target: RoundTarget
    let placeName: String
    var chatMembers: [String] = []
    var quiz = false

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(\.dismiss) private var dismiss
    @State private var groupGames: [RemoteGame] = []
    @State private var loading = true
    @State private var startingID: String?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    Section {
                        Label(failure, systemImage: "exclamationmark.circle")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                let games = candidates
                if games.isEmpty {
                    Section {
                        if loading {
                            LiveDataStateView(kind: .loading, title: "Finding games…")
                        } else {
                            LiveDataStateView(kind: .empty(RoundsCopy.noGamesDetail), title: RoundsCopy.noGames)
                        }
                    }
                } else {
                    Section(target.kind == .group && !groupGames.isEmpty ? "Games for \(placeName)" : RoundsCopy.pickGame) {
                        ForEach(games, id: \.id) { game in
                            row(game)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(quiz ? RoundsCopy.startQuiz : RoundsCopy.startRound)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                if target.kind == .group {
                    groupGames = ((try? await GamesAPIFactory.current.groupGames(id: target.id)) ?? []).filter { $0.formula == "microgame" }
                }
                loading = false
            }
        }
    }

    /// The Group's microgames, then the feed's (server games only), quiz-like first for a quiz night.
    private var candidates: [RemoteGame] {
        var seen = Set<String>()
        let feed = bubbleStore.feedBubbles.compactMap { bubbleStore.remoteGames[$0.id] ?? bubbleStore.remoteGames[$0.serverID] }
            .filter { $0.formula == "microgame" }
        var all = (groupGames + feed).filter { seen.insert($0.id).inserted }
        if quiz {
            let quizzy: (RemoteGame) -> Bool = { g in
                let text = (g.tags + [g.title, g.description]).joined(separator: " ").lowercased()
                return ["quiz", "trivia", "question", "guess"].contains { text.contains($0) }
            }
            all = all.filter(quizzy) + all.filter { !quizzy($0) }
        }
        return Array(all.prefix(30))
    }

    private func row(_ game: RemoteGame) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(game.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                if !game.description.isEmpty {
                    Text(game.description)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            Button {
                start(game)
            } label: {
                if startingID == game.id { ProgressView() } else { Text(RoundsCopy.start) }
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
            .disabled(startingID != nil)
        }
        .frame(minHeight: 44)
    }

    private func start(_ game: RemoteGame) {
        Haptics.light()
        startingID = game.id
        failure = nil
        Task { @MainActor in
            do {
                try await RoundsCenter.shared.start(gameID: game.id, target: target, members: target.kind == .chat ? chatMembers : [],
                                                    mode: quiz ? "group_round" : nil)
                appStore.showToast(RoundsCopy.started(placeName), symbol: "person.3.fill")
                dismiss()
            } catch {
                failure = "Couldn't start it: \(error.localizedDescription)"
                startingID = nil
            }
        }
    }
}

// MARK: - Picking a place for a game

/// "Play it together" from a game: pick one of your Groups, or friends for a chat round.
struct RoundDestinationSheet: View {
    let bubble: Bubble
    var mode: String? = nil

    @Environment(AppStore.self) private var appStore
    @Environment(\.dismiss) private var dismiss
    @State private var groups: [RemoteGroup] = []
    @State private var friends: [RemoteProfile] = []
    @State private var picked: Set<String> = []
    @State private var loading = true
    @State private var starting: String?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(RoundsCopy.startRoundDetail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                if let failure {
                    Section {
                        Label(failure, systemImage: "exclamationmark.circle")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                if loading {
                    Section { LiveDataStateView(kind: .loading, title: "Loading your Groups and friends…") }
                }
                if !groups.isEmpty {
                    Section(RoundsCopy.yourGroups) {
                        ForEach(groups) { group in
                            HStack {
                                Text(group.name)
                                    .font(.fbName)
                                    .foregroundStyle(FBColor.primaryText)
                                Spacer(minLength: 8)
                                Button {
                                    start(RoundTarget(kind: .group, id: group.id), members: [], place: group.name)
                                } label: {
                                    if starting == group.id { ProgressView() } else { Text(RoundsCopy.start) }
                                }
                                .buttonStyle(.fb(.primary, expand: false, height: 32))
                                .disabled(starting != nil)
                            }
                            .frame(minHeight: 44)
                        }
                    }
                }
                if !friends.isEmpty {
                    Section(RoundsCopy.friends) {
                        ForEach(friends) { friend in
                            Button {
                                if picked.contains(friend.id) { picked.remove(friend.id) } else { picked.insert(friend.id) }
                            } label: {
                                HStack {
                                    Text(friend.shownName)
                                        .font(.fbName)
                                        .foregroundStyle(FBColor.primaryText)
                                    Spacer(minLength: 8)
                                    Image(systemName: picked.contains(friend.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(picked.contains(friend.id) ? FBColor.accent : FBColor.tertiaryText)
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                        Button {
                            let ids = Array(picked)
                            let names = friends.filter { picked.contains($0.id) }.map(\.shownName)
                            start(RoundTarget(kind: .chat, id: RoundsCenter.chatID(for: ids + [RoundsCenter.shared.meID ?? ""])),
                                  members: ids, place: names.joined(separator: ", "))
                        } label: {
                            if starting == "chat" { ProgressView() } else {
                                Text(picked.isEmpty ? "Pick friends" : "Start with \(picked.count == 1 ? "1 friend" : "\(picked.count) friends")")
                            }
                        }
                        .buttonStyle(.fb(.primary, height: 40))
                        .disabled(picked.isEmpty || starting != nil)
                    }
                }
                if !loading && groups.isEmpty && friends.isEmpty {
                    Section {
                        LiveDataStateView(kind: .empty("Add a friend or join a Group to play together."), title: "No one to play with yet")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(RoundsCopy.pickPlace)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                async let g = try? GamesAPIFactory.current.groups(kind: "group", mine: true)
                async let f = try? GamesAPIFactory.current.friends()
                groups = await g ?? []
                friends = await f ?? []
                loading = false
            }
        }
    }

    private func start(_ target: RoundTarget, members: [String], place: String) {
        Haptics.light()
        starting = target.kind == .group ? target.id : "chat"
        failure = nil
        Task { @MainActor in
            do {
                let round = try await RoundsCenter.shared.start(gameID: bubble.id, target: target, members: members, mode: mode)
                appStore.showToast(RoundsCopy.started(place), symbol: "person.3.fill")
                dismiss()
                _ = round
            } catch {
                failure = "Couldn't start it: \(error.localizedDescription)"
                starting = nil
            }
        }
    }
}

// MARK: - A Group's rounds on its Games tab

/// The Group's open rounds, with Start a round, on the Group's Games tab.
struct GroupRoundsCard: View {
    let group: FBGroup

    @Environment(Router.self) private var router
    @State private var picking = false

    private var target: RoundTarget { RoundTarget(kind: .group, id: group.id) }

    var body: some View {
        let rounds = RoundsCenter.shared.list(target)
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(RoundsCopy.title)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Spacer(minLength: 8)
                if !rounds.isEmpty {
                    Button("See all") {
                        router.push(.bubbleFeature(BubbleFeatureRoute(.challenge, "rounds", target.wire)))
                    }
                    .font(.fbButton)
                    .foregroundStyle(FBColor.accent)
                }
            }
            ForEach(rounds.prefix(2)) { round in
                RoundCardView(round: round, placeName: nil)
                    .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusSmall).stroke(FBColor.divider, lineWidth: 0.5))
            }
            if rounds.isEmpty {
                Text(RoundsCopy.startRoundDetail)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Haptics.light()
                picking = true
            } label: {
                Label(RoundsCopy.startRound, systemImage: "person.3.fill")
            }
            .buttonStyle(.fb(.tinted, height: 40))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .task(id: group.id) { RoundsCenter.shared.load(target, quiet: true) }
        .sheet(isPresented: $picking) {
            RoundGamePickerSheet(target: target, placeName: group.name)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}
