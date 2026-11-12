import SwiftUI

// Slot views for the "learn" feature (docs/BUBBLES.md 7.8). Owner: learn.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Keep each
// struct's name and stored properties (its call signature). Every slot draws nothing for Bubbles
// that aren't lessons.

/// What you learned, mastery and streak on the result sheet.
struct LearnResultRecap: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        if slot.bubble.formula == .learn {
            LearnRecapPanel(slot: slot)
        }
    }
}

/// Mastery and friends' streaks on a lesson's page.
struct LearnDetailMastery: View {
    let bubble: Bubble

    var body: some View {
        if bubble.formula == .learn {
            LearnDetailPanel(bubble: bubble)
        }
    }
}

/// Group mastery meter ('New in SF knows 82% of the hills').
struct LearnGroupMastery: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        if !LearnProgressStore.shared.lessons(in: group, bubbleStore: bubbleStore).isEmpty {
            VStack(spacing: 0) {
                ProfileGap()
                LearnGroupMeterCard(group: group)
            }
        }
    }
}

/// Learning streak on a profile's Bubbles tab.
struct LearnProfileStreak: View {
    let user: User

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @State private var sent = false

    var body: some View {
        let progress = LearnProgressStore.shared
        let days = progress.streak(of: user)
        let lessons = bubbleStore.bubbles.filter { $0.formula == .learn }
        let best = lessons
            .compactMap { lesson in progress.mastery(of: user, in: lesson, bubbleStore: bubbleStore).map { (lesson, $0) } }
            .max { $0.1 < $1.1 }
        if days > 0 || best != nil {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(LearnStyle.gradient)
                        Image(systemName: "flame.fill")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .frame(width: 40, height: 40)
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(LearnCopy.learningStreak(days))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        if let best {
                            Text(LearnCopy.profileLearning(best.0.title, percent: LearnCopy.percent(best.1)))
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    if !user.isMe, let lesson = best?.0 ?? lessons.first {
                        Button(sent ? LearnCopy.sent : LearnCopy.sendLesson) {
                            Haptics.light()
                            let target = BubbleShareTarget(kind: .friend, targetID: user.id, title: user.name)
                            let tag = progress.lastTag[lesson.id].flatMap(LearnResultTag.init)
                            if LearnShare.send(lesson, tag: tag, to: target, appStore: appStore, bubbleStore: bubbleStore) {
                                sent = true
                                appStore.showToast(LearnCopy.sharedTo(user.firstName), symbol: "paperplane.fill")
                            }
                        }
                        .buttonStyle(.fb(sent ? .secondary : .tinted, expand: false, height: 32))
                        .disabled(sent)
                        .accessibilityLabel(LearnCopy.sendLessonTo(user.firstName))
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FBColor.surface)
                .accessibilityElement(children: .contain)
                ProfileGap()
            }
        }
    }
}

/// Friends' streaks above the Library sections.
struct LearnLibraryStreaks: View {
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        let rows = LearnProgressStore.shared.friendsStreaks(appStore: appStore, bubbleStore: bubbleStore)
        if rows.count > 1 {
            VStack(alignment: .leading, spacing: 10) {
                LearnSectionHeader(title: LearnCopy.learningStreaks, trailing: LearnCopy.seeAll) {
                    router.push(.bubbleFeature(BubbleFeatureRoute(.learn, "streaks")))
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(rows, id: \.user.id) { row in
                            Button {
                                router.push(row.user.isMe ? .bubbleFeature(BubbleFeatureRoute(.learn, "streaks")) : .profile(row.user))
                            } label: {
                                LearnStreakAvatar(user: row.user, days: row.days)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, FBMetrics.screenPadding)
                    .padding(.bottom, 2)
                }
            }
        }
    }
}

/// Studio Ask entry: turn a topic or notes into a lesson.
struct LearnStudioEntry: View {
    let model: StudioModel

    @State private var showSheet = false

    var body: some View {
        if model.mode == .create || model.mode == .daily {
            let notes = model.social?.lessonNotes ?? ""
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    Haptics.light()
                    showSheet = true
                } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(LearnStyle.gradient)
                            Image(systemName: "graduationcap.fill")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        .frame(width: 38, height: 38)
                        .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(LearnCopy.studioEntryTitle)
                                .font(.fbName)
                                .foregroundStyle(FBColor.primaryText)
                            Text(LearnCopy.studioEntrySubtitle)
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right")
                            .font(.system(size: FBIconSize.small, weight: .semibold))
                            .foregroundStyle(FBColor.secondaryText)
                            .accessibilityHidden(true)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LearnCopy.studioEntryTitle)
                if !notes.isEmpty {
                    HStack(spacing: 8) {
                        Label("\(LearnCopy.notesAttached) · \(LearnCopy.notesWords(notes.split { $0 == " " || $0 == "\n" }.count))", systemImage: "doc.text")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(LearnStyle.purple)
                        Spacer(minLength: 4)
                        Button {
                            Haptics.selection()
                            var social = model.social ?? StudioSocialContext()
                            social.lessonNotes = nil
                            model.social = social
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(FBColor.secondaryText)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(LearnCopy.removeNotes)
                    }
                }
            }
            .studioCard(padding: FBSpacing.m, highlighted: model.formulaHint == .learn)
            .padding(.horizontal, FBMetrics.screenPadding)
            .sheet(isPresented: $showSheet) {
                LearnNotesSheet(initialTopic: "", initialNotes: notes) { topic, newNotes in
                    showSheet = false
                    model.formulaHint = .learn
                    model.prompt = LearnCopy.lessonPrompt(topic: topic)
                    var social = model.social ?? StudioSocialContext()
                    social.lessonNotes = newNotes.isEmpty ? nil : newNotes
                    model.social = social
                } onCancel: {
                    showSheet = false
                }
            }
        }
    }
}

/// Shared lesson cards.
struct LearnCardBody: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        LearnLessonCardView(card: card, placement: placement)
    }
}

// MARK: - Result recap

/// The result sheet for a lesson: the mastery ring, your streak next to friends', what you
/// learned, the Group meter with your run in it, and one tap to share the lesson with the Group or
/// the crew chat.
private struct LearnRecapPanel: View {
    let slot: BubbleResultSlotContext

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    @State private var shared: Set<String> = []

    var body: some View {
        let progress = LearnProgressStore.shared
        let bubble = slot.bubble
        let lesson = LearnLesson(bubble)
        let tag = LearnResultTag(slot.result.result.share.tag)
        let group = LearnShare.group(for: bubble, appStore: appStore, bubbleStore: bubbleStore)
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 16) {
                LearnMasteryRing(value: tag?.mastery ?? 0, title: tag?.text ?? "–", size: 92)
                VStack(alignment: .leading, spacing: 6) {
                    Text(lesson.title)
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                    LearnStreakBadge(days: progress.myStreak, long: true)
                    friendsLine(progress)
                }
                Spacer(minLength: 0)
            }

            if !lesson.points.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(LearnCopy.whatYouLearned)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                    let known = lesson.knownPoints(missed: tag?.missed ?? [])
                    ForEach(Array(lesson.points.enumerated()), id: \.offset) { index, point in
                        let isKnown = known.indices.contains(index) ? known[index] : true
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: isKnown ? "checkmark.circle.fill" : "arrow.counterclockwise.circle.fill")
                                .foregroundStyle(isKnown ? LearnStyle.blue : LearnStyle.purple)
                                .accessibilityLabel(isKnown ? LearnCopy.youKnowIt : LearnCopy.reviewHint)
                            Text(point)
                                .font(.fbBody)
                                .foregroundStyle(FBColor.primaryText)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }

            if let group {
                let value = progress.groupMastery(of: bubble, group: group, bubbleStore: bubbleStore)
                if value > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(LearnCopy.groupKnows(group.name, percent: Int((value * 100).rounded()), subject: lesson.subject))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        LearnMeterBar(value: value)
                    }
                    .accessibilityElement(children: .combine)
                }
            }

            shareButtons(bubble: bubble, tag: tag, group: group)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LearnStyle.tint.opacity(0.55), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .onAppear {
            // The feed's result sheet doesn't go through the player's didFinish; noting is idempotent.
            // DEBUG fake results never reach the board, so they never count as your mastery either.
            if slot.result.isRecorded {
                progress.notePlay(bubble, tag: slot.result.result.share.tag)
            }
            if let group {
                progress.warmUp([bubble], people: progress.learners(in: group, lessons: [bubble], bubbleStore: bubbleStore), bubbleStore: bubbleStore)
            }
        }
    }

    @ViewBuilder
    private func friendsLine(_ progress: LearnProgressStore) -> some View {
        let friends = progress.friendsStreaks(appStore: appStore, bubbleStore: bubbleStore).filter { !$0.user.isMe }.prefix(3)
        if !friends.isEmpty {
            HStack(spacing: -6) {
                ForEach(Array(friends), id: \.user.id) { row in
                    AvatarView(user: row.user, size: 22)
                        .overlay(Circle().stroke(FBColor.surface, lineWidth: 2))
                }
                Text(friends.map { "\($0.user.firstName) \($0.days)" }.joined(separator: " · "))
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
                    .padding(.leading, 12)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(LearnCopy.friendsStreaksLabel(friends.map { ($0.user.firstName, $0.days) }))
        }
    }

    @ViewBuilder
    private func shareButtons(bubble: Bubble, tag: LearnResultTag?, group: FBGroup?) -> some View {
        let crew = BubbleSocialCast.conversation(BubbleSocialCast.newInSFCrew, in: appStore)
        VStack(spacing: 8) {
            if let group {
                let target = BubbleShareTarget(kind: .group, targetID: group.id, title: group.name)
                shareButton(target: target, title: LearnCopy.shareWith(group.name), symbol: "person.3.fill", kind: .primary, bubble: bubble, tag: tag) {
                    router.push(.bubbleFeature(BubbleFeatureRoute(.learn, "group", group.id)))
                }
            }
            if let crew {
                let target = BubbleShareTarget(kind: .chat, targetID: crew.id, title: crew.title)
                shareButton(target: target, title: LearnCopy.sendTo(crew.title), symbol: "message.fill", kind: .tinted, bubble: bubble, tag: tag) {
                    router.openChat(crew)
                }
            }
        }
    }

    private func shareButton(target: BubbleShareTarget, title: String, symbol: String, kind: FBButtonStyle.Kind, bubble: Bubble, tag: LearnResultTag?, open: @escaping () -> Void) -> some View {
        let done = shared.contains(target.id)
        return Button {
            if done {
                slot.leavingPlayer(open)
                return
            }
            Haptics.success()
            if LearnShare.send(bubble, tag: tag, seed: slot.request?.seed, to: target, appStore: appStore, bubbleStore: bubbleStore) {
                shared.insert(target.id)
                appStore.showToast(LearnCopy.sharedTo(target.title), symbol: "graduationcap.fill")
            }
        } label: {
            Label(done ? LearnCopy.viewShared(target.title) : title, systemImage: done ? "checkmark" : symbol)
        }
        .buttonStyle(.fb(done ? .secondary : kind, height: 40))
        .accessibilityLabel(done ? LearnCopy.viewShared(target.title) : title)
    }
}

// MARK: - Lesson page

/// On a lesson's page: your mastery and streak, the Group meter, friends who learned it with
/// their streaks, and Share lesson.
private struct LearnDetailPanel: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    var body: some View {
        let progress = LearnProgressStore.shared
        let lesson = LearnLesson(bubble)
        let mine = progress.best[bubble.id]
        let group = LearnShare.group(for: bubble, appStore: appStore, bubbleStore: bubbleStore)
        let people = peers(progress)
        VStack(alignment: .leading, spacing: 14) {
            LearnSectionHeader(title: LearnCopy.learnTogether)
            HStack(spacing: 14) {
                LearnMasteryRing(value: mine ?? 0, title: mine.map(LearnCopy.percent) ?? "–", caption: LearnCopy.yourMastery, size: 76, lineWidth: 8)
                VStack(alignment: .leading, spacing: 6) {
                    if mine == nil {
                        Text(LearnCopy.notPracticedYet)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if let tag = progress.lastTag[bubble.id].flatMap(LearnResultTag.init) {
                        Text(LearnCopy.masteryLine(tag.text))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                    }
                    LearnStreakBadge(days: progress.myStreak, long: true)
                }
            }
            if let group {
                let value = progress.groupMastery(of: bubble, group: group, bubbleStore: bubbleStore)
                if value > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(LearnCopy.groupKnows(group.name, percent: Int((value * 100).rounded()), subject: lesson.subject))
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        LearnMeterBar(value: value)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if !people.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(people.enumerated()), id: \.element.user.id) { index, row in
                        if index > 0 { HairlineDivider() }
                        Button {
                            router.push(.profile(row.user))
                        } label: {
                            HStack(spacing: 10) {
                                AvatarView(user: row.user, size: 36)
                                Text(row.user.name)
                                    .font(.fbName)
                                    .foregroundStyle(FBColor.primaryText)
                                    .lineLimit(1)
                                Spacer(minLength: 8)
                                Text(LearnCopy.percent(row.mastery))
                                    .font(.fbMetaEmphasized)
                                    .foregroundStyle(FBColor.secondaryText)
                                    .monospacedDigit()
                                LearnStreakBadge(days: progress.streak(of: row.user))
                            }
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(row.user.name), \(LearnCopy.percent(row.mastery)), \(LearnCopy.learningStreak(progress.streak(of: row.user)))")
                    }
                }
            }
            Menu {
                ForEach(LearnShare.targets(for: bubble, appStore: appStore, bubbleStore: bubbleStore)) { target in
                    Button(target.title) {
                        let tag = progress.lastTag[bubble.id].flatMap(LearnResultTag.init)
                        if LearnShare.send(bubble, tag: tag, to: target, appStore: appStore, bubbleStore: bubbleStore) {
                            Haptics.success()
                            appStore.showToast(LearnCopy.sharedTo(target.title), symbol: "graduationcap.fill")
                        }
                    }
                }
            } label: {
                Label(LearnCopy.shareLesson, systemImage: "paperplane.fill")
                    .font(.fbButton)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .foregroundStyle(FBColor.accent)
                    .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            }
            .accessibilityLabel(LearnCopy.shareLesson)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).strokeBorder(FBColor.divider, lineWidth: 1))
        .onAppear {
            let friends = BubbleSocialCast.friendIDs.map { bubbleStore.resolvePerson($0) }
            var learners = friends
            if let group { learners += progress.learners(in: group, lessons: [bubble], bubbleStore: bubbleStore) }
            progress.warmUp([bubble], people: learners, bubbleStore: bubbleStore)
        }
    }

    /// Friends first, then the Group's best learners: who learned it and how well.
    private func peers(_ progress: LearnProgressStore) -> [(user: User, mastery: Double)] {
        var people = BubbleSocialCast.friendIDs.map { bubbleStore.resolvePerson($0) }
        if let group = LearnShare.group(for: bubble, appStore: appStore, bubbleStore: bubbleStore) {
            people += progress.learners(in: group, lessons: [bubble], bubbleStore: bubbleStore)
        }
        var seen = Set<String>()
        let rows = people.compactMap { user -> (user: User, mastery: Double)? in
            guard !user.isMe, seen.insert(user.id).inserted, let value = progress.mastery(of: user, in: bubble, bubbleStore: bubbleStore) else { return nil }
            return (user, value)
        }
        let friendSet = Set(BubbleSocialCast.friendIDs)
        return Array(rows.sorted { a, b in
            let fa = friendSet.contains(a.user.id), fb = friendSet.contains(b.user.id)
            return fa != fb ? fa : a.mastery > b.mastery
        }.prefix(5))
    }
}
