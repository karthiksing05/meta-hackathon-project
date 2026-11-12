import SwiftUI

// Slot views for the "together" feature (docs/BUBBLES.md 7.4). Owner: together.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Keep each
// struct's name and stored properties (its call signature).

/// 'Made by Maya, Leo and you' credits on the Bubble page, and 'A game about Maya' for games
/// about someone.
struct TogetherDetailCredits: View {
    let bubble: Bubble

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        let makers = bubble.manifest.lineage.makers ?? []
        if makers.count > 1 || bubble.manifest.about != nil {
            VStack(alignment: .leading, spacing: 14) {
                if makers.count > 1 { credits(makers) }
                if let about = bubble.manifest.about { aboutRow(about) }
            }
        }
    }

    private func isMe(_ id: String) -> Bool { id == appStore.me.id || id == "me" }

    private func credits(_ makers: [BubbleMaker]) -> some View {
        let people = makers.map { bubbleStore.resolvePerson($0.id) }
        // Others first, you last: "Made by Maya, Diego and you".
        let ordered = makers.filter { !isMe($0.id) } + makers.filter { isMe($0.id) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(TogetherCopy.madeTogether)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                TogetherMakersStack(users: people, size: 28)
            }
            Text(TogetherCopy.madeBy(makers.map { isMe($0.id) ? nil : $0.name }))
                .font(.fbBodyLarge.weight(.semibold))
                .foregroundStyle(FBColor.primaryText)
            VStack(spacing: 0) {
                ForEach(Array(ordered.enumerated()), id: \.element.id) { index, maker in
                    if index > 0 { HairlineDivider().padding(.leading, 48) }
                    makerRow(maker)
                }
            }
            .background(FBColor.inputBackground.opacity(0.6), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        }
    }

    private func makerRow(_ maker: BubbleMaker) -> some View {
        let user = bubbleStore.resolvePerson(maker.id)
        let role = maker.role == "starter" ? "Started it" : nil
        let detail = [role, maker.contribution.map { "Added \($0)" }].compactMap { $0 }.joined(separator: " · ")
        return NavigationLink(value: Route.profile(user)) {
            HStack(spacing: 10) {
                AvatarView(user: user, size: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(isMe(maker.id) ? "You" : user.name)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    if !detail.isEmpty {
                        Text(detail)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                    .foregroundStyle(FBColor.tertiaryText)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel([isMe(maker.id) ? "You" : user.name, detail].joined(separator: ", "))
    }

    private func aboutRow(_ about: BubbleAboutMe) -> some View {
        let subject = bubbleStore.resolvePerson(about.subjectID)
        let template = TogetherStudio.template(about.template)
        let name = isMe(about.subjectID) ? "you" : about.subjectName
        return NavigationLink(value: Route.bubbleFeature(BubbleFeatureRoute(.together, "profile", subject.id))) {
            HStack(spacing: 12) {
                AvatarView(user: subject, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(TogetherCopy.gameAbout(name))
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(template?.title ?? about.template)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    Text(isMe(about.subjectID) ? TogetherCopy.whoKnowsYouBest : TogetherCopy.whoKnowsBest(about.subjectName))
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                }
                Spacer(minLength: 0)
                Text(template?.emoji ?? "🫧")
                    .font(.system(size: 26)) // Emoji glyph
                    .accessibilityHidden(true)
            }
            .padding(12)
            .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(TogetherCopy.gameAbout(name)), \(template?.title ?? "")")
    }
}

/// 'Make a game together' row on the Group's Games tab, with the Group's sessions in progress.
struct TogetherGroupMakeRow: View {
    let group: FBGroup

    @Environment(Router.self) private var router

    var body: some View {
        let sessions = TogetherCenter.shared.sessions.filter { $0.target.kind == .group && $0.target.targetID == group.id }
        VStack(alignment: .leading, spacing: 0) {
            Button {
                Haptics.light()
                router.bubbleSheet = BubbleFeatureRoute(.together, "start", "group:\(group.id)")
            } label: {
                HStack(spacing: 12) {
                    TogetherBadge(size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(TogetherCopy.groupRowTitle(group.name))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .multilineTextAlignment(.leading)
                        Text(TogetherCopy.groupRowSubtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.small, weight: .semibold))
                        .foregroundStyle(FBColor.secondaryText)
                }
                .padding(FBMetrics.screenPadding)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TogetherCopy.groupRowTitle(group.name))
            ForEach(sessions) { session in
                HairlineDivider().padding(.leading, 72)
                NavigationLink(value: Route.bubbleFeature(BubbleFeatureRoute(.together, "session", session.id))) {
                    HStack(spacing: 10) {
                        Image(systemName: TogetherCopy.kindSymbol(session.kind))
                            .foregroundStyle(FBColor.accent)
                            .frame(width: 44)
                        Text(TogetherCopy.groupSessionRow(session.title, count: session.entries.count))
                            .font(.fbBody)
                            .foregroundStyle(FBColor.primaryText)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, FBMetrics.screenPadding)
                    .padding(.vertical, 10)
                }
                .buttonStyle(.plain)
            }
        }
        .background(FBColor.surface)
        .padding(.bottom, FBMetrics.feedSeparatorHeight)
        .background(FBColor.feedSeparator)
    }
}

/// 'Games about me' section on a profile's Bubbles tab, with who knows them best.
struct TogetherProfileAboutMe: View {
    let user: User

    var body: some View {
        TogetherAboutSection(user: user, showsEmptyForOthers: false, trailingGap: true)
    }
}

/// Games about a person, who knows them best, and (for you) making one. Draws nothing for
/// someone else with no games about them unless `showsEmptyForOthers`.
struct TogetherAboutSection: View {
    let user: User
    var showsEmptyForOthers = false
    /// A profile gap after the section (on the profile's Bubbles tab).
    var trailingGap = false

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    private var isMe: Bool { user.isMe || user.id == appStore.me.id }

    private var games: [Bubble] {
        bubbleStore.bubbles.filter { bubble in
            guard let about = bubble.manifest.about else { return false }
            return about.subjectID == user.id || (isMe && about.subjectID == "me")
        }
    }

    /// Best score per game per person (not the subject), summed; for you, friends only.
    private var knowers: [(user: User, total: Int, games: Int, right: String?)] {
        var totals: [String: (User, Int, Int, String?)] = [:]
        for bubble in games {
            var best: [String: BubbleScore] = [:]
            for entry in bubble.scores where entry.user.id != user.id && !entry.user.isMe {
                if isMe && !entry.user.isFriend { continue }
                if let current = best[entry.user.id], current.score >= entry.score { continue }
                best[entry.user.id] = entry
            }
            for (id, entry) in best {
                let current = totals[id] ?? (entry.user, 0, 0, nil)
                totals[id] = (entry.user, current.1 + entry.score, current.2 + 1, current.3 ?? Self.rightLine(entry.share?.scoreText))
            }
        }
        return totals.values.map { ($0.0, $0.1, $0.2, $0.3) }.sorted { $0.total > $1.total }
    }

    var body: some View {
        let games = games
        if !games.isEmpty || isMe || showsEmptyForOthers {
            VStack(alignment: .leading, spacing: 14) {
                header(hasGames: !games.isEmpty)
                if games.isEmpty {
                    emptyState
                } else {
                    gameStrip(games)
                    whoKnowsBest
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface)
            if trailingGap { ProfileGap() }
        }
    }

    private func header(hasGames: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(isMe ? TogetherCopy.aboutMeTitle : TogetherCopy.gamesAbout(user.firstName))
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if isMe && hasGames {
                Button(TogetherCopy.makeAnother) {
                    Haptics.light()
                    router.bubbleSheet = BubbleFeatureRoute(.together, "aboutme")
                }
                .font(.fbButton)
                .foregroundStyle(FBColor.accent)
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if isMe {
            VStack(alignment: .leading, spacing: 10) {
                Text(TogetherCopy.aboutMeSubtitle)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(AboutMeTemplates.all) { template in
                    Button {
                        Haptics.light()
                        router.bubbleSheet = BubbleFeatureRoute(.together, "aboutme", template.id)
                    } label: {
                        AboutMeTemplateRow(template: template, compact: true)
                            .overlay(
                                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                                    .strokeBorder(FBColor.divider, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("\(TogetherCopy.makeAboutMe): \(template.title)")
                }
            }
        } else {
            Text(TogetherCopy.noKnowers(user.firstName, isMe: false))
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
        }
    }

    private func gameStrip(_ games: [Bubble]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(games) { bubble in
                    VStack(alignment: .leading, spacing: 6) {
                        NavigationLink(value: Route.bubble(bubble.id)) {
                            BubbleCard(bubble: bubble, style: .compact)
                                .frame(width: 124)
                        }
                        .buttonStyle(.pressable)
                        .accessibilityLabel(bubble.title)
                        Text(bubble.title)
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(2)
                            .frame(width: 124, alignment: .leading)
                        if !isMe {
                            Button {
                                Haptics.light()
                                router.play(bubble.id)
                            } label: {
                                Label(TogetherCopy.playIt, systemImage: "play.fill")
                            }
                            .buttonStyle(.fb(.primary, height: 32))
                            .frame(width: 124)
                            .accessibilityLabel("\(TogetherCopy.playIt): \(bubble.title)")
                        }
                    }
                }
            }
        }
    }

    private var whoKnowsBest: some View {
        let rows = Array(knowers.prefix(3))
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "trophy.fill")
                    .foregroundStyle(FBColor.feelingYellow)
                Text(isMe ? TogetherCopy.whoKnowsYouBest : TogetherCopy.whoKnowsBest(user.firstName))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
            }
            if rows.isEmpty {
                Text(TogetherCopy.noKnowers(user.firstName, isMe: isMe))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.user.id) { index, row in
                        if index > 0 { HairlineDivider().padding(.leading, 76) }
                        knowerRow(rank: index + 1, row)
                    }
                }
                .background(FBColor.inputBackground.opacity(0.6), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            }
        }
        .animation(.default, value: rows.map(\.user.id))
    }

    private func knowerRow(rank: Int, _ row: (user: User, total: Int, games: Int, right: String?)) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.fbHeadline.monospacedDigit())
                .foregroundStyle(rank == 1 ? FBColor.brandBlue : FBColor.secondaryText)
                .frame(width: 18)
            NavigationLink(value: Route.profile(row.user)) {
                HStack(spacing: 10) {
                    AvatarView(user: row.user, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.user.name)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text(TogetherCopy.knowerDetail(games: row.games, right: row.right))
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
            addFriendButton(row.user)
            Text("\(row.total)")
                .font(.fbName.monospacedDigit())
                .foregroundStyle(FBColor.primaryText)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func addFriendButton(_ person: User) -> some View {
        if person.friendship == .none {
            Button {
                Haptics.light()
                appStore.sendRequest(to: person)
                if let bubble = games.first {
                    BubbleSocialSignals.post(.addFriendFromGame, bubbleID: bubble.id, with: [person.id])
                }
            } label: {
                Label(TogetherCopy.addFriend, systemImage: "person.badge.plus")
                    .labelStyle(.iconOnly)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 32))
            .accessibilityLabel("\(TogetherCopy.addFriend): \(person.name)")
        } else if person.friendship == .requestSent {
            Image(systemName: "checkmark")
                .font(.system(size: FBIconSize.small, weight: .bold))
                .foregroundStyle(FBColor.secondaryText)
                .accessibilityLabel(TogetherCopy.requested)
        }
    }

    /// "5/6 right" from a share line like "1165 points · 5/6 right".
    static func rightLine(_ text: String?) -> String? {
        guard let text, let range = text.range(of: "·") else { return nil }
        let tail = text[range.upperBound...].trimmingCharacters(in: .whitespaces)
        return tail.isEmpty ? nil : tail
    }
}

/// `together/profile/<id>`: a person's games about them and who knows them best, with a link to
/// their full profile.
struct TogetherAboutPage: View {
    let userID: String

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        let user = userID.isEmpty || userID == "me" || userID == appStore.me.id ? appStore.me : bubbleStore.resolvePerson(userID)
        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 10) {
                    AvatarView(user: user, size: 88)
                    Text(user.name)
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    NavigationLink(value: Route.profile(user)) {
                        Text("See profile")
                    }
                    .buttonStyle(.fb(.secondary, expand: false, height: 32))
                }
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity)
                .background(FBColor.surface)
                .padding(.bottom, FBMetrics.feedSeparatorHeight)
                TogetherAboutSection(user: user, showsEmptyForOthers: true)
            }
        }
        .background(FBColor.background)
        .navigationTitle(user.isMe ? TogetherCopy.aboutMeTitle : TogetherCopy.gamesAbout(user.firstName))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Studio Ask entries: Make it together, Games about me. When Studio was opened to stitch a
/// session or make a game about you, a banner shows what Muse is working from instead.
struct TogetherStudioEntry: View {
    let model: StudioModel

    @Environment(Router.self) private var router
    @Environment(BubbleStore.self) private var bubbleStore

    @State private var showsStart = false
    @State private var showsAboutMe = false

    var body: some View {
        Group {
            if let social = model.social, TogetherStudio.isMadeTogether(social) {
                stitchBanner(social)
            } else if let social = model.social, let templateID = social.aboutMeTemplate {
                aboutBanner(templateID)
            } else if model.mode == .create {
                HStack(spacing: 8) {
                    entryCard(title: TogetherCopy.studioTogetherTitle, subtitle: TogetherCopy.studioTogetherSubtitle, symbol: "person.3.sequence.fill") {
                        showsStart = true
                    }
                    entryCard(title: TogetherCopy.studioAboutTitle, subtitle: TogetherCopy.studioAboutSubtitle, symbol: "person.crop.circle.badge.questionmark") {
                        showsAboutMe = true
                    }
                }
            }
        }
        .onAppear(perform: applyFormulaHint)
        .sheet(isPresented: $showsStart) {
            TogetherStartSheet { sessionID in
                TogetherNav.openSession(sessionID, router: router)
            }
        }
        .sheet(isPresented: $showsAboutMe) {
            AboutMeFlow { prompt, social in
                // Stay in this Studio: Muse works from the answers.
                model.social = social
                model.prompt = prompt
                model.formulaHint = .answer
            }
        }
    }

    /// Questions stitch into the answer formula and words into guess; about-me is always answer.
    private func applyFormulaHint() {
        guard let social = model.social, model.formulaHint == nil else { return }
        if social.aboutMeTemplate != nil {
            model.formulaHint = .answer
        } else if let kind = social.contributions.first.flatMap({ TogetherAskKind(rawValue: $0.kind) }), let formula = kind.formula,
                  kind != .scene {
            model.formulaHint = formula
        }
    }

    private func entryCard(title: String, subtitle: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                TogetherBadge(symbol: symbol, size: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Text(subtitle)
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                    .strokeBorder(FBColor.divider, lineWidth: 1)
            )
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("\(title). \(subtitle)")
    }

    private func stitchBanner(_ social: StudioSocialContext) -> some View {
        let makers = TogetherStudio.normalizedMakers(social, creatorName: model.me?.firstName ?? "Alex")
        let people = makers.map { bubbleStore.resolvePerson($0.id) }
        let names = TogetherStudio.names(makers.map { $0.id == model.me?.id || $0.id == "me" ? "you" : $0.name })
        return banner(
            leading: AnyView(TogetherMakersStack(users: people, size: 30)),
            title: TogetherCopy.stitching(social.contributions.count, names: names),
            detail: TogetherCopy.stitchHint
        )
    }

    private func aboutBanner(_ templateID: String) -> some View {
        let template = TogetherStudio.template(templateID)
        return banner(
            leading: AnyView(Text(template?.emoji ?? "🫧").font(.system(size: 24))), // Emoji glyph
            title: TogetherCopy.aboutMeBanner(template?.title ?? templateID),
            detail: TogetherCopy.aboutMeBannerDetail
        )
    }

    private func banner(leading: AnyView, title: String, detail: String) -> some View {
        HStack(spacing: 12) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Contribution and invite cards.
struct TogetherCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        TogetherCardView(card: card, placement: placement)
    }
}
