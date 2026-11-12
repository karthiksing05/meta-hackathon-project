import SwiftUI

/// A co-making session (`together/session/<id>`): the game being made, contributions arriving
/// with avatars, your own, and "Stitch with Muse". Once published it shows the finished game
/// with every maker credited.
struct TogetherSessionView: View {
    let sessionID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var question = ""
    @State private var answer = ""
    @State private var decoys = ""
    @State private var freeText = ""
    @FocusState private var focused: Bool

    private var center: TogetherCenter { TogetherCenter.shared }

    var body: some View {
        Group {
            if let session = center.session(id: sessionID) {
                content(session)
            } else {
                ContentUnavailableView(
                    TogetherCopy.sessionGone,
                    systemImage: "person.3.sequence",
                    description: Text(TogetherCopy.startSubtitle)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(FBColor.background)
            }
        }
        .navigationTitle(center.session(id: sessionID)?.title ?? TogetherCopy.startTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ session: TogetherSession) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header(session)
                if let id = session.bubbleID, let bubble = bubbleStore.bubble(id: id) {
                    liveCard(bubble)
                }
                contributions(session)
                if session.bubbleID == nil {
                    // Stitch sits right under the contributions, inside the scroll view: pinned
                    // to the bottom of a pushed tab screen it slid under the tab bar.
                    stitchBar(session)
                    composer(session)
                }
            }
            .padding(.vertical, 12)
            .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: session.entries.count)
        }
        .background(FBColor.background)
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            if let chat = BubbleSocialHub.conversation(for: session.target, appStore: appStore, bubbleStore: bubbleStore), session.target.kind != .group {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        router.openChat(chat)
                    } label: {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                    }
                    .accessibilityLabel(TogetherCopy.openChat)
                }
            }
        }
    }

    // MARK: Header

    private func header(_ session: TogetherSession) -> some View {
        let makers = session.makerIDs.map { bubbleStore.resolvePerson($0) }
        let invited = (session.invitedIDs.filter { !session.makerIDs.contains($0) }).map { bubbleStore.resolvePerson($0) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label(TogetherCopy.kindTitle(session.kind), systemImage: TogetherCopy.kindSymbol(session.kind))
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(TogetherStyle.gradient, in: Capsule())
                Text(TogetherCopy.inTarget(session.target.title))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Text(session.title)
                .font(.fbLargeTitle)
                .foregroundStyle(FBColor.primaryText)
            Text(session.ask)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                TogetherMakersStack(users: makers + invited, size: 32, limit: 5)
                Text(TogetherCopy.makingTogether(TogetherStudio.names(makers.map { $0.isMe ? TogetherCopy.you : $0.firstName } + invited.map(\.firstName))))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
            }
        }
        .padding(FBMetrics.screenPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    // MARK: Contributions

    private func contributions(_ session: TogetherSession) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(TogetherCopy.contributions)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if !session.entries.isEmpty {
                    Text(TogetherCopy.addedCount(session.entries.count))
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                }
            }
            if session.entries.isEmpty && session.pendingIDs.isEmpty {
                VStack(spacing: 6) {
                    TogetherBadge(symbol: "hourglass", size: 36)
                    Text(TogetherCopy.noContributionsYet)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(TogetherCopy.noContributionsDetail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .padding(20)
                .frame(maxWidth: .infinity)
            }
            ForEach(session.entries) { entry in
                entryRow(entry)
                    .transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
            }
            if session.bubbleID == nil {
                ForEach(session.pendingIDs, id: \.self) { id in
                    waitingRow(bubbleStore.resolvePerson(id), kind: session.kind)
                }
            }
        }
        .padding(FBMetrics.screenPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private func entryRow(_ entry: TogetherEntry) -> some View {
        let maker = bubbleStore.resolvePerson(entry.makerID)
        return HStack(alignment: .top, spacing: 10) {
            NavigationLink(value: Route.profile(maker)) {
                AvatarView(user: maker, size: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(maker.name)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text(maker.isMe ? TogetherCopy.you : entry.makerName)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(TogetherCopy.addedKind(entry.kind))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    Spacer(minLength: 0)
                    Text(entry.arrivedAt, style: .relative)
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.tertiaryText)
                        .lineLimit(1)
                }
                TogetherContributionContent(kind: entry.kind, text: entry.text, compact: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func waitingRow(_ user: User, kind: TogetherAskKind) -> some View {
        HStack(spacing: 10) {
            AvatarView(user: user, size: 36)
                .opacity(0.7)
            Text(TogetherCopy.waiting(user.firstName, kind: kind))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            TogetherTypingDots()
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Live

    private func liveCard(_ bubble: Bubble) -> some View {
        let makers = bubble.manifest.lineage.makers ?? []
        let people = makers.map { bubbleStore.resolvePerson($0.id) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                BubbleCoverView(bubble: bubble, showsEmoji: true)
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(TogetherCopy.liveTitle(bubble.title))
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                    HStack(spacing: 6) {
                        TogetherMakersStack(users: people, size: 20)
                        Text(TogetherCopy.madeBy(makers.map { $0.id == appStore.me.id || $0.id == "me" ? nil : $0.name }))
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(2)
                    }
                }
            }
            HStack(spacing: 8) {
                Button {
                    Haptics.light()
                    router.play(BubblePlayRequest(bubbleID: bubble.id, context: BubblePlayContext(kind: .contribution, id: sessionID)))
                } label: {
                    Label(TogetherCopy.playButton, systemImage: "play.fill")
                }
                .buttonStyle(.fb(.primary, height: 36))
                NavigationLink(value: Route.bubble(bubble.id)) {
                    Text(TogetherCopy.openGame)
                }
                .buttonStyle(.fb(.secondary, height: 36))
            }
        }
        .padding(FBMetrics.screenPadding)
        .background(FBColor.surface)
    }

    // MARK: Composer

    private func composer(_ session: TogetherSession) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(TogetherCopy.addYoursTitle)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            switch session.kind {
            case .question:
                field(TogetherCopy.yourQuestion, text: $question)
                field(TogetherCopy.rightAnswer, text: $answer)
                field(TogetherCopy.wrongAnswers, text: $decoys)
            case .words:
                field(TogetherCopy.wordsPlaceholder, text: $freeText)
                    .textInputAutocapitalization(.characters)
            case .scene:
                field(TogetherCopy.scenePlaceholder, text: $freeText, lines: 3)
            case .level:
                field(TogetherCopy.levelPlaceholder, text: $freeText, lines: 3)
            }
            Button {
                add(session)
            } label: {
                Label(TogetherCopy.addButton, systemImage: "plus")
            }
            .buttonStyle(.fb(.tinted, height: 36))
            .disabled(!canAdd(session))
        }
        .padding(FBMetrics.screenPadding)
        .background(FBColor.surface)
    }

    private func field(_ placeholder: String, text: Binding<String>, lines: Int = 1) -> some View {
        TextField(placeholder, text: text, axis: .vertical)
            .lineLimit(lines...max(lines, 4))
            .font(.fbBodyLarge)
            .padding(10)
            .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            .focused($focused)
            .accessibilityLabel(placeholder)
    }

    private func canAdd(_ session: TogetherSession) -> Bool {
        switch session.kind {
        case .question:
            return !question.trimmingCharacters(in: .whitespaces).isEmpty && !answer.trimmingCharacters(in: .whitespaces).isEmpty
        case .words:
            return !TogetherStudio.parseWords(freeText).isEmpty
        case .scene, .level:
            return freeText.trimmingCharacters(in: .whitespaces).count >= 3
        }
    }

    private func add(_ session: TogetherSession) {
        let text: String
        switch session.kind {
        case .question:
            var ask = question.trimmingCharacters(in: .whitespacesAndNewlines)
            if !ask.hasSuffix("?") { ask += "?" }
            text = TogetherStudio.encodeQuestion(.init(question: ask, answer: answer, decoys: decoys.split(separator: ",").map(String.init)))
        default:
            text = freeText
        }
        Haptics.success()
        center.addMine(text, to: session.id, appStore: appStore, bubbleStore: bubbleStore)
        question = ""; answer = ""; decoys = ""; freeText = ""
        focused = false
    }

    // MARK: Stitch

    private func stitchBar(_ session: TogetherSession) -> some View {
        let ready = !session.friendEntries.isEmpty
        return VStack(spacing: 6) {
            HairlineDivider()
            Button {
                stitch(session)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                    Text(TogetherCopy.stitchButton)
                }
                .font(.fbButton)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(TogetherStyle.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .opacity(ready ? 1 : 0.45)
            }
            .buttonStyle(.plain)
            .disabled(!ready)
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.top, 6)
            .accessibilityLabel(TogetherCopy.stitchButton)
            .accessibilityHint(ready ? TogetherCopy.stitchHint : TogetherCopy.stitchNeedsMore)
            Text(ready ? TogetherCopy.stitchHint : TogetherCopy.stitchNeedsMore)
                .font(.fbCaption)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.bottom, 8)
        }
        .background(FBColor.surface)
    }

    private func stitch(_ session: TogetherSession) {
        guard let launch = center.stitchLaunch(session.id, appStore: appStore) else { return }
        Haptics.medium()
        TogetherNav.afterCovers(router) {
            router.openStudio(launch)
        }
    }
}

/// Three dots that pulse while someone is adding, driven by TimelineView (no repeating animation).
struct TogetherTypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.35)) { context in
            let step = reduceMotion ? -1 : Int(context.date.timeIntervalSinceReferenceDate / 0.35) % 3
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(FBColor.secondaryText)
                        .frame(width: 5, height: 5)
                        .opacity(step == index ? 1 : 0.35)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
