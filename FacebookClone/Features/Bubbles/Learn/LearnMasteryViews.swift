import SwiftUI

// Shared pieces for the learn feature's screens and slots (docs/BUBBLES.md 7.8): the mastery ring,
// the Group meter, streak badges, the Group's "Learn together" card and the streaks screen.

/// Learn's colors: Facebook blue to purple only.
enum LearnStyle {
    static let blue = FBColor.brandBlue
    static let purple = FBColor.savedPurple
    static let gradient = LinearGradient(colors: [FBColor.brandBlue, FBColor.savedPurple], startPoint: .leading, endPoint: .trailing)
    static let track = FBColor.buttonGray
    static let tint = FBColor.tintedBlueBackground
}

/// A ring that fills to `value` (0–1), with text in the middle.
struct LearnMasteryRing: View {
    let value: Double
    var title: String
    var caption: String = LearnCopy.mastered
    var size: CGFloat = 96
    var lineWidth: CGFloat = 10

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double = 0

    var body: some View {
        ZStack {
            Circle()
                .stroke(LearnStyle.track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.001, shown))
                .stroke(AngularGradient(colors: [LearnStyle.blue, LearnStyle.purple, LearnStyle.blue], center: .center),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(title)
                    .font(.system(size: size * 0.24, weight: .heavy, design: .rounded))
                    .foregroundStyle(FBColor.primaryText)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(caption)
                    .font(.fbMicroEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            .padding(lineWidth + 4)
        }
        .frame(width: size, height: size)
        .onAppear {
            if reduceMotion {
                shown = value
            } else {
                withAnimation(.easeOut(duration: 0.9).delay(0.15)) { shown = value }
            }
        }
        .onChange(of: value) { _, newValue in
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.5)) { shown = newValue }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) \(caption)")
    }
}

/// A horizontal meter in blue to purple.
struct LearnMeterBar: View {
    let value: Double
    var height: CGFloat = 10

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(LearnStyle.track)
                Capsule()
                    .fill(LearnStyle.gradient)
                    .frame(width: max(height, proxy.size.width * min(1, max(0, value))))
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.6), value: value)
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityValue(LearnCopy.percent(value))
    }
}

/// "🔥 6" in a small pill.
struct LearnStreakBadge: View {
    let days: Int
    var long = false

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "flame.fill")
                .font(.system(size: FBIconSize.xs, weight: .bold))
            Text(long ? LearnCopy.streakDays(days) : "\(days)")
                .font(.fbCaptionEmphasized)
                .monospacedDigit()
        }
        .foregroundStyle(days > 0 ? LearnStyle.purple : FBColor.secondaryText)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(LearnStyle.tint, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LearnCopy.streakDays(days))
    }
}

/// A small "Learn" label with the graduation cap.
struct LearnSectionHeader: View {
    let title: String
    var trailing: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "graduationcap.fill")
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(LearnStyle.purple)
                .accessibilityHidden(true)
            Text(title)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            if let trailing, let action {
                Button(trailing, action: action)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.accent)
            }
        }
    }
}

/// An avatar with a streak badge under it.
struct LearnStreakAvatar: View {
    let user: User
    let days: Int
    var size: CGFloat = 52

    var body: some View {
        VStack(spacing: 4) {
            AvatarView(user: user, size: size)
                .overlay(alignment: .bottom) {
                    LearnStreakBadge(days: days)
                        .offset(y: 8)
                }
            Text(user.isMe ? LearnCopy.you : user.firstName)
                .font(.fbCaption)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
                .padding(.top, 6)
        }
        .frame(width: size + 18)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(user.isMe ? LearnCopy.you : user.name), \(LearnCopy.learningStreak(days))")
    }
}

// MARK: - The Group's "Learn together" card

/// "New in SF knows 82% of the hills": the Group meter for its newest lesson, its top learners
/// with their streaks, every lesson with the Group's and your mastery, and Make a lesson.
struct LearnGroupMeterCard: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    @State private var showNotes = false

    var body: some View {
        let progress = LearnProgressStore.shared
        let lessons = progress.lessons(in: group, bubbleStore: bubbleStore)
        VStack(alignment: .leading, spacing: 14) {
            LearnSectionHeader(title: LearnCopy.learnTogether)
            if let featured = lessons.first {
                meter(featured, progress: progress)
                if lessons.count > 1 {
                    Text(LearnCopy.acrossLessons(lessons.count, percent: Int((progress.groupMastery(group: group, in: bubbleStore) * 100).rounded())))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                VStack(spacing: 0) {
                    ForEach(Array(lessons.prefix(4).enumerated()), id: \.element.id) { index, lesson in
                        if index > 0 { HairlineDivider() }
                        LearnLessonRow(bubble: lesson, group: group)
                    }
                }
            } else {
                Text(LearnCopy.noLessonsDetail)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Button {
                Haptics.light()
                showNotes = true
            } label: {
                Label(LearnCopy.makeLessonFor(group.name), systemImage: "graduationcap")
            }
            .buttonStyle(.fb(.tinted, height: 36))
            .accessibilityLabel(LearnCopy.makeLessonFor(group.name))
        }
        .padding(FBMetrics.screenPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .onAppear {
            progress.warmUp(group: group, bubbleStore: bubbleStore)
        }
        .sheet(isPresented: $showNotes) {
            LearnNotesSheet { topic, notes in
                showNotes = false
                let launch = StudioLaunch(
                    groupID: group.id,
                    prompt: LearnCopy.lessonPrompt(topic: topic),
                    social: notes.isEmpty ? nil : StudioSocialContext(lessonNotes: notes)
                )
                // Let the sheet finish closing before Studio's cover opens.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    router.openStudio(launch)
                }
            } onCancel: {
                showNotes = false
            }
        }
    }

    private func meter(_ lesson: Bubble, progress: LearnProgressStore) -> some View {
        let value = progress.groupMastery(of: lesson, group: group, bubbleStore: bubbleStore)
        let subject = LearnLesson(lesson).subject
        let top = progress.topLearners(of: lesson, group: group, bubbleStore: bubbleStore)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(LearnCopy.percent(value))
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .foregroundStyle(LearnStyle.gradient)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text(LearnCopy.groupKnows(group.name, percent: Int((value * 100).rounded()), subject: subject))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            LearnMeterBar(value: value, height: 12)
            if value == 0 {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(LearnCopy.countingLearners)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            if !top.isEmpty {
                HStack(spacing: 12) {
                    Text(LearnCopy.topLearners)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                    ForEach(top, id: \.user.id) { row in
                        Button {
                            router.push(.profile(row.user))
                        } label: {
                            HStack(spacing: 4) {
                                AvatarView(user: row.user, size: 26)
                                LearnStreakBadge(days: progress.streak(of: row.user))
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(row.user.name), \(LearnCopy.percent(row.mastery)), \(LearnCopy.learningStreak(progress.streak(of: row.user)))")
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One lesson in a Group: cover, title, the Group's and your mastery, Learn it.
struct LearnLessonRow: View {
    let bubble: Bubble
    let group: FBGroup?

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let progress = LearnProgressStore.shared
        let mine = progress.best[bubble.id]
        HStack(spacing: 12) {
            Button {
                router.push(.bubble(bubble.id))
            } label: {
                HStack(spacing: 12) {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                        .frame(width: 48, height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(bubble.title)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        HStack(spacing: 6) {
                            if let group {
                                Text("\(group.name) \(LearnCopy.percent(progress.groupMastery(of: bubble, group: group, bubbleStore: bubbleStore)))")
                            }
                            if let mine {
                                Text("· \(LearnCopy.you) \(LearnCopy.percent(mine))")
                            }
                        }
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Spacer(minLength: 8)
            Button(LearnCopy.learnIt) {
                Haptics.light()
                router.play(BubblePlayRequest(bubbleID: bubble.id, context: BubblePlayContext(kind: .lesson, id: "lesson-\(bubble.id)", opponentName: group?.name)))
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
            .accessibilityLabel("\(LearnCopy.learnIt): \(bubble.title)")
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Streaks screen (feature:learn/streaks)

/// You and your friends' learning streaks, the lessons to learn, and a one-tap "Send a lesson".
struct LearnStreaksView: View {
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    @State private var sentTo: Set<String> = []

    var body: some View {
        let progress = LearnProgressStore.shared
        let rows = progress.friendsStreaks(appStore: appStore, bubbleStore: bubbleStore)
        let lessons = bubbleStore.bubbles.filter { $0.formula == .learn }
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero(progress)
                    .padding(.horizontal, FBMetrics.screenPadding)
                VStack(alignment: .leading, spacing: 0) {
                    LearnSectionHeader(title: LearnCopy.friendsStreaks)
                        .padding(.bottom, 6)
                    ForEach(Array(rows.enumerated()), id: \.element.user.id) { index, row in
                        if index > 0 { HairlineDivider() }
                        personRow(row.user, days: row.days, lesson: lessons.first, progress: progress)
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
                ProfileGap()
                VStack(alignment: .leading, spacing: 0) {
                    LearnSectionHeader(title: LearnCopy.lessonsToLearn)
                        .padding(.bottom, 6)
                    if lessons.isEmpty {
                        Text(LearnCopy.noLessonsDetail)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    ForEach(Array(lessons.enumerated()), id: \.element.id) { index, lesson in
                        if index > 0 { HairlineDivider() }
                        LearnLessonRow(bubble: lesson, group: lesson.group)
                    }
                }
                .padding(.horizontal, FBMetrics.screenPadding)
            }
            .padding(.vertical, 16)
        }
        .background(FBColor.surface)
        .navigationTitle(LearnCopy.streaksTitle)
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .bottom) {
            ToastHost().padding(.bottom, 16)
        }
    }

    private func hero(_ progress: LearnProgressStore) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(LearnStyle.gradient)
                Image(systemName: "flame.fill")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 64, height: 64)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(LearnCopy.learningStreak(progress.myStreak))
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Text(LearnCopy.studioEntrySubtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LearnStyle.tint, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func personRow(_ user: User, days: Int, lesson: Bubble?, progress: LearnProgressStore) -> some View {
        HStack(spacing: 12) {
            Button {
                router.push(.profile(user))
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.isMe ? LearnCopy.you : user.name)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Text(LearnCopy.learningStreak(days))
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Spacer(minLength: 8)
            LearnStreakBadge(days: days)
            if !user.isMe, let lesson {
                let sent = sentTo.contains(user.id)
                Button(sent ? LearnCopy.sent : LearnCopy.sendLesson) {
                    Haptics.light()
                    let target = BubbleShareTarget(kind: .friend, targetID: user.id, title: user.name)
                    if LearnShare.send(lesson, tag: progress.lastTag[lesson.id].flatMap(LearnResultTag.init), to: target, appStore: appStore, bubbleStore: bubbleStore) {
                        sentTo.insert(user.id)
                        appStore.showToast(LearnCopy.sharedTo(user.firstName), symbol: "paperplane.fill")
                    }
                }
                .buttonStyle(.fb(sent ? .secondary : .tinted, expand: false, height: 32))
                .disabled(sent)
                .accessibilityLabel(LearnCopy.sendLessonTo(user.name))
            }
        }
        .padding(.vertical, 8)
    }
}
