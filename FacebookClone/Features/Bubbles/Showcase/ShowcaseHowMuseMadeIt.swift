import SwiftUI

/// The game page's Muse section: who you sent it to ("Sent to Maya, Leo and Priya"), then
/// "How Muse made it": the brief, the building blocks, the checks and fixes, the playtest and the
/// models. The brief and the model stamp come from the manifest, so every Muse-made game shows
/// them; the rest comes from `MakeRecordStore`, kept when it was shared from this device.
struct ShowcaseDetailSection: View {
    let bubble: Bubble

    @State private var store = MakeRecordStore.shared

    var body: some View {
        let record = store.record(for: bubble.id)
        VStack(alignment: .leading, spacing: 12) {
            if let record, !record.sentTo.isEmpty {
                ShowcaseSentBanner(record: record, title: bubble.title)
            }
            if bubble.isMadeWithMuse {
                ShowcaseHowMuseMadeIt(bubble: bubble, record: record)
            }
        }
    }
}

/// "Sent to Maya, Leo and Priya": the people this game went to from Studio.
struct ShowcaseSentBanner: View {
    let record: MakeRecord
    let title: String

    @Environment(AppStore.self) private var appStore

    var body: some View {
        let people = record.sentTo.compactMap { appStore.user(id: $0.id) }
        HStack(spacing: 12) {
            if !people.isEmpty {
                StudioFaceStack(people: people, size: FBAvatarSize.comment, limit: 3)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Sent to \(MakeRecord.names(record.sentTo.map(\.name)))")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Image(systemName: record.isMicrogame ? "paperplane.fill" : "flag.checkered")
                .font(.system(size: FBIconSize.regular, weight: .semibold))
                .foregroundStyle(GameColor.deep)
                .accessibilityHidden(true)
        }
        .padding(12)
        .background(GameColor.wash, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let count = record.sentTo.count
        let who = count == 1 ? "They" : "All \(count)"
        let what = record.isMicrogame ? "got \(title) in Messenger" : "got a challenge in Messenger, same course as you"
        if let place = record.sharedTo { return "\(who) \(what) · Also shared to \(place)" }
        return "\(who) \(what)"
    }
}

/// "How Muse made it": a collapsible card of what Muse really did for this game.
struct ShowcaseHowMuseMadeIt: View {
    let bubble: Bubble
    let record: MakeRecord?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// DEBUG: `FB_SHOWCASE_OPEN=1` starts it open, for screenshots.
    @State private var isOpen = DebugLaunch.value("FB_SHOWCASE_OPEN") == "1"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                Haptics.selection()
                withAnimation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion)) { isOpen.toggle() }
            } label: {
                HStack(spacing: 10) {
                    GameOrb(size: 28, sparkle: true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("How Muse made it")
                            .font(.fbTitle)
                            .foregroundStyle(FBColor.primaryText)
                        Text(summary)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: FBIconSize.small, weight: .semibold))
                        .foregroundStyle(FBColor.tertiaryText)
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHint(isOpen ? "Hides the details" : "Shows the brief, the building blocks, the checks and the playtest")

            if isOpen {
                VStack(alignment: .leading, spacing: 16) {
                    briefSection
                    blocksSection
                    contentSection
                    checksSection
                    playtestSection
                    creditSection
                }
                .padding(.top, 12)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(14)
        .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(GameColor.periwinkle.opacity(0.6), lineWidth: 1)
        }
    }

    // MARK: Summary

    /// "Built from scratch · fixed 2 issues · playtested by 5 bots · 41 s".
    private var summary: String {
        var parts: [String] = []
        parts.append((record?.isMicrogame ?? (bubble.formula == .microgame)) ? "Built from scratch" : "Built from \(blocks.count) building blocks")
        if let record {
            let fixed = record.repairs.count
            parts.append(fixed == 0 ? "passed every check" : "\(fixed) fix \(fixed == 1 ? "round" : "rounds")")
            if let playtest = record.playtest {
                parts.append(playtest.lanes.isEmpty ? "playtested by bots" : "playtested by \(playtest.lanes.count) bots")
            }
        }
        if let seconds = record?.seconds ?? bubble.manifest.studio?.durationSec, seconds > 0 {
            parts.append("\(Int(seconds.rounded())) s")
        }
        return parts.joined(separator: " · ")
    }

    private var blocks: [String] {
        if let concepts = record?.concepts, !concepts.isEmpty { return concepts }
        if bubble.formula == .microgame {
            let fragments = StudioMicrogameBridge.fragments(of: bubble.manifest)
            if !fragments.isEmpty { return fragments }
        }
        return bubble.manifest.conceptIDs
    }

    // MARK: Sections

    private var briefSection: some View {
        let brief = bubble.manifest.brief
        return section("The brief", symbol: "doc.text") {
            Text("“\(brief.intent)”")
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            FlowLayout(spacing: 6, lineSpacing: 6) {
                ForEach(brief.mood, id: \.self) { mood in
                    chip(mood.prefix(1).uppercased() + mood.dropFirst())
                }
                chip("\(StudioModel.title(forEnergy: brief.energy)) energy")
                chip(StudioModel.title(forCompetition: brief.competition))
                if let occasion = brief.occasion {
                    chip(StudioModel.title(forOccasion: occasion))
                }
            }
            if let notes = brief.notes, !notes.isEmpty {
                Text(notes)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var blocksSection: some View {
        let ids = blocks
        if !ids.isEmpty {
            let isFragments = ids.allSatisfy { $0.hasPrefix("fragment.") }
            section(isFragments ? "Game pieces Muse picked" : "Building blocks Muse picked", symbol: "square.stack.3d.up") {
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(ids, id: \.self) { id in
                        StudioConceptChip(concept: StudioConceptInfo(id: id))
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private var contentSection: some View {
        if let content = record?.content, !content.isEmpty {
            section("What Muse wrote", symbol: "text.word.spacing") {
                ForEach(content, id: \.self) { line in
                    Text(line)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        if let used = record?.sourcesUsed, !used.isEmpty {
            StudioSourcesUsedLabel(names: used)
        }
    }

    @ViewBuilder
    private var checksSection: some View {
        if let record {
            section("Checks and fixes", symbol: "checkmark.shield") {
                if record.repairs.isEmpty {
                    Text("Passed every check on the first try.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                } else {
                    ForEach(Array(record.repairs.enumerated()), id: \.offset) { index, repair in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Round \(index + 1): \(repair.title)")
                                .font(.fbMetaEmphasized)
                                .foregroundStyle(FBColor.primaryText)
                            if !repair.problems.isEmpty {
                                StudioIssueList(issues: repair.problems, isFixed: false)
                            }
                            if !repair.fixes.isEmpty {
                                StudioIssueList(issues: repair.fixes, isFixed: true)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var playtestSection: some View {
        if let playtest = record?.playtest {
            section("Playtest", symbol: "gamecontroller") {
                Text(playtest.title)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = playtest.detail {
                    Text(detail)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !playtest.lanes.isEmpty {
                    ShowcaseBotLanes(lanes: playtest.lanes, animatesIn: false)
                }
            }
        }
    }

    private var creditSection: some View {
        let models = record?.models ?? bubble.manifest.studio?.models ?? []
        return HStack(spacing: 6) {
            Text("Made with")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            ForEach(models, id: \.self) { id in
                if let info = StudioModelInfo(model: id, isOffline: false) {
                    StudioModelChip(info: info)
                }
            }
            if record?.isOffline == true || bubble.manifest.studio?.offline == true {
                StudioModelChip(info: StudioModelInfo(name: "Offline composer", tint: StudioGlow.offline, symbol: "bolt.horizontal.circle"))
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Pieces

    private func section<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.fbCaptionEmphasized)
            .foregroundStyle(GameColor.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(GameColor.gradient, in: Capsule())
    }
}
