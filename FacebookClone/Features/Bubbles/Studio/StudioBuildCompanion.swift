import SwiftUI

/// What a new game's Build step shows under its header while Muse works (about a minute): the
/// steps so far, the brief, and "How the game works" with Muse's questions to answer. Calm on
/// purpose: one card per thing, the latest step only (every step on request), no auto-scrolling.
struct StudioBuildCompanion: View {
    let model: StudioModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FBSpacing.l) {
                if let failure = model.failure {
                    StudioComposeFailureCard(failure: failure)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                StudioBuildStepsCard(model: model)
                if let brief = model.brief {
                    StudioBriefSummaryCard(model: model, brief: brief)
                }
                // New games that went through the server's plan have no anatomy draft: no empty card.
                if model.showsAnatomyCard, model.anatomyThread.anatomy != nil || model.anatomyThread.isWorking {
                    StudioAnatomyCard(thread: model.anatomyThread, buildNote: buildNote)
                        .id("anatomy")
                }
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.top, FBSpacing.xs)
            .padding(.bottom, FBSpacing.xl)
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: model.failure)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
    }

    /// The line at the top of "How the game works" while the game builds.
    private var buildNote: StudioAnatomyBuildNote? {
        guard model.isComposing || model.isFinished else { return nil }
        if model.isWaitingForAnatomy {
            return StudioAnatomyBuildNote(text: "Muse starts building as soon as this is ready.", isChange: false)
        }
        if let changes = model.buildChanges, let anatomy = model.anatomyThread.anatomy {
            return StudioAnatomyBuildNote(
                text: "You \(changes.whatYouDid(in: anatomy)). This version won't have \(changes.count == 1 ? "it" : "them") yet; you can add \(changes.count == 1 ? "it" : "them") as a quick change when it's ready.",
                isChange: true
            )
        }
        return StudioAnatomyBuildNote(
            text: "Muse is building from this. Change a part or answer a question, and it goes in as a quick change once the first version is ready.",
            isChange: false
        )
    }
}

// MARK: - Muse at work

/// The storyboard (lit by real events), the latest step with its details, and every step so far
/// behind "All steps".
private struct StudioBuildStepsCard: View {
    let model: StudioModel

    @State private var showsAll = false

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            StudioSectionTitle(title: "Muse at work", detail: stepCount, symbol: "sparkles")
            ShowcaseBuildStage(
                events: model.events,
                isMicrogame: model.runIsMicrogame,
                kind: model.composeKind,
                isWorking: model.isComposing,
                failed: model.failure != nil
            )
            .padding(.horizontal, -FBSpacing.l)
            VStack(alignment: .leading, spacing: 2) {
                if model.events.isEmpty {
                    if model.isComposing { StudioStartingRow(model: model) }
                } else if showsAll {
                    ForEach(Array(model.events.indices), id: \.self) { index in
                        StudioComposeEventRow(model: model, index: index, showsConnector: index < model.events.count - 1)
                            .transition(.opacity)
                    }
                } else {
                    // The old step and the new one cross-fade in place, so the card never holds both.
                    ZStack(alignment: .topLeading) {
                        StudioComposeEventRow(model: model, index: model.events.count - 1)
                            .id(model.events.last?.id)
                            .transition(.opacity)
                    }
                }
            }
            .padding(.horizontal, -FBSpacing.m)
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: model.events.count)
            if model.events.count > 1 {
                Button {
                    Haptics.selection()
                    withAnimation(.easeInOut(duration: 0.25)) { showsAll.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Text(showsAll ? "Show the latest step" : "All \(model.events.count) steps")
                        Image(systemName: showsAll ? "chevron.up" : "chevron.down")
                            .font(.system(size: FBIconSize.xs, weight: .bold))
                    }
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.accent)
                    .frame(minHeight: 32)
                }
                .buttonStyle(.plain)
            }
        }
        .studioCard()
    }

    private var stepCount: String? {
        model.events.isEmpty ? nil : "\(model.events.count) \(model.events.count == 1 ? "step" : "steps")"
    }
}

// MARK: - Brief

/// The brief Muse is building from, in one glance: the idea, who it's for, the feel.
private struct StudioBriefSummaryCard: View {
    let model: StudioModel
    let brief: BubbleBrief

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            StudioSectionTitle(title: "Your brief", detail: model.audiencePhrase.prefix(1).uppercased() + model.audiencePhrase.dropFirst(), symbol: "doc.text")
            Text("“\(brief.intent)”")
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            FlowLayout(spacing: FBSpacing.xs, lineSpacing: FBSpacing.xs) {
                ForEach(tags, id: \.self) { tag in
                    Text(tag)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(StudioGlow.fieldFill, in: Capsule())
                        .overlay(Capsule().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.5))
                }
            }
        }
        .studioCard()
        .accessibilityElement(children: .combine)
    }

    private var tags: [String] {
        var out = brief.mood.prefix(3).map { $0.prefix(1).uppercased() + $0.dropFirst() }
        out.append("\(StudioModel.title(forEnergy: brief.energy)) energy")
        out.append(StudioModel.title(forCompetition: brief.competition) + (brief.competition == "none" ? "" : " competition"))
        if brief.occasion != nil { out.append(StudioModel.title(forOccasion: brief.occasion)) }
        if let sound = model.soundHint { out.append("\(sound.prefix(1).uppercased() + sound.dropFirst()) sounds") }
        if let look = model.lookHint { out.append(look.title) }
        return out
    }
}

// MARK: - Changes made while it built (Try)

/// On Try, under the player: the edits and answers made on the Build step aren't in this version
/// yet. One tap adds them as a quick change (a change on the server, about a minute); "Keep it
/// as is" stops offering it.
struct StudioBuildChangesCard: View {
    let model: StudioModel
    let changes: AnatomyBuildChanges

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            HStack(alignment: .top, spacing: FBSpacing.s) {
                StudioMuseAvatar(size: 28)
                VStack(alignment: .leading, spacing: 4) {
                    Text(headline)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Play this one first if you like. Adding \(changes.count == 1 ? "it" : "them") is a quick change, about a minute.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack(spacing: FBSpacing.s) {
                Button {
                    Haptics.selection()
                    withAnimation(.easeInOut(duration: 0.25)) { model.keepBuildAsIs() }
                } label: {
                    Text("Keep it as is")
                }
                .buttonStyle(.studioSecondary(expand: false, height: 40))
                Button {
                    Haptics.light()
                    model.applyBuildChanges()
                } label: {
                    Label(changes.count == 1 ? "Add my change" : "Add my \(changes.count) changes", systemImage: "wand.and.stars")
                }
                .buttonStyle(.studioPrimary)
                .disabled(model.isComposing)
            }
        }
        .studioCard(highlighted: true)
    }

    private var headline: String {
        guard let anatomy = model.anatomyThread.anatomy else { return "Your changes aren't in this version yet." }
        return "While I was building, you \(changes.whatYouDid(in: anatomy)). \(changes.count == 1 ? "That isn't" : "Those aren't") in this version yet."
    }
}
