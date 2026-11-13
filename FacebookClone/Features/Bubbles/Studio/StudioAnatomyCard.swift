import SwiftUI

/// "How the game works" on the Brief step: Muse's anatomy of the game (docs/BUBBLES.md 7.13) as a
/// compact list of parts and numbered rules. Each part says whether the person said it or Muse
/// guessed, and how well Muse knows it. Parts that are new to Muse say how it plans to build them
/// and may ask a question. Tap a part to rewrite it; type below to change or add a rule, and Muse
/// rereads the whole thing.
struct StudioAnatomyCard: View {
    let thread: StudioAnatomyThread
    /// On the Build step: how edits made now reach the game (a quick change once it's ready).
    var buildNote: StudioAnatomyBuildNote? = nil

    @State private var editingSlot: String?
    @State private var draftText = ""
    @State private var refineText = ""
    @State private var editVoice = VoiceInput()
    @FocusState private var focus: Field?

    private enum Field: Hashable { case edit, refine }

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(title: "How the game works", detail: thread.anatomy.map { "\($0.partCount) parts" }, symbol: "puzzlepiece.extension")
            if let buildNote {
                buildNoteRow(buildNote)
                    .transition(.opacity)
            }
            if let anatomy = thread.anatomy {
                summary(anatomy)
                if let reply = thread.lastReply {
                    StudioAnatomyMuseLine(text: reply)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(anatomy.parts) { part in
                        row(slot: part.id, anatomy: anatomy) {
                            StudioAnatomyPartRow(title: part.key.title, symbol: part.key.symbol, text: part.text, details: part.details, meta: part.meta,
                                                 isHighlighted: thread.highlighted.contains(part.id))
                        }
                    }
                    if !anatomy.rules.isEmpty {
                        Text("Rules")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.secondaryText)
                            .padding(.top, FBSpacing.m)
                            .padding(.bottom, FBSpacing.xs)
                            .id("anatomy-rules")
                    }
                    ForEach(anatomy.rules) { rule in
                        row(slot: rule.id, anatomy: anatomy) {
                            StudioAnatomyPartRow(title: "Rule \(rule.n)", number: rule.n, text: rule.text, details: rule.check.map { ["Muse checks: \($0)"] } ?? [],
                                                 meta: rule.meta, isHighlighted: thread.highlighted.contains(rule.id))
                        }
                    }
                }
                refineField
                if thread.hasLocalChanges && !thread.isWorking {
                    Button {
                        Haptics.light()
                        thread.refine("")
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                            Text("Have Muse check my changes")
                        }
                    }
                    .buttonStyle(.studioSecondary(expand: true, height: 40))
                    .transition(.opacity)
                }
            } else if thread.isWorking {
                loading
            } else if let note = thread.note {
                // The server's words for what went wrong (503: Muse isn't set up; 502: a bad reply).
                VStack(alignment: .leading, spacing: FBSpacing.s) {
                    Text(note)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Try again") {
                        Haptics.light()
                        thread.draft(request: thread.request, audience: thread.audience)
                    }
                    .buttonStyle(.studioSecondary(expand: false, height: 40))
                }
            }
            if thread.isWorking && thread.anatomy != nil {
                HStack(spacing: FBSpacing.s) {
                    ProgressView()
                    Text("Muse is rereading the game…")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            if let note = thread.note, thread.anatomy != nil {
                Text(note)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
        .studioCard()
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: thread.anatomy)
        .animation(.easeInOut(duration: 0.2), value: thread.isWorking)
    }

    // MARK: Pieces

    private func buildNoteRow(_ note: StudioAnatomyBuildNote) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: note.isChange ? "wand.and.stars" : "hammer")
                .font(.system(size: FBIconSize.xs, weight: .semibold))
            Text(note.text)
                .font(.fbMeta)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(note.isChange ? FBColor.primaryText : FBColor.secondaryText)
        .padding(.horizontal, FBSpacing.m)
        .padding(.vertical, FBSpacing.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .fill(note.isChange ? AnyShapeStyle(GameColor.violet.opacity(0.14)) : AnyShapeStyle(StudioGlow.fieldFill))
        }
        .animation(.easeInOut(duration: 0.25), value: note)
        .accessibilityElement(children: .combine)
    }

    private func summary(_ anatomy: GameAnatomy) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(anatomy.summaryLine)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
            Text(countsLine(anatomy))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private func countsLine(_ anatomy: GameAnatomy) -> String {
        var parts = ["\(anatomy.guessCount) guessed by Muse"]
        let open = anatomy.openQuestions.count
        if open > 0 { parts.append(open == 1 ? "1 question for you" : "\(open) questions for you") }
        parts.append("tap a part to change it")
        return GameAnatomy.sentence(parts.joined(separator: " · "))
    }

    private var loading: some View {
        HStack(alignment: .top, spacing: FBSpacing.m) {
            ProgressView()
                .padding(.top, 2)
            Text("Muse is taking your game apart: the loop, the rules, how it ends and what's new to it.")
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, FBSpacing.s)
    }

    /// One tappable row, with its edit field and question below.
    @ViewBuilder
    private func row<Content: View>(slot: String, anatomy: GameAnatomy, @ViewBuilder content: () -> Content) -> some View {
        let meta = anatomy.meta(slot: slot) ?? AnatomyMeta()
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            if editingSlot == slot {
                editor(slot: slot)
            } else {
                Button {
                    Haptics.selection()
                    draftText = anatomy.text(slot: slot) ?? ""
                    withAnimation(.easeInOut(duration: 0.2)) { editingSlot = slot }
                    focus = .edit
                } label: {
                    content()
                }
                .buttonStyle(.plain)
                .accessibilityHint("Change this part")
            }
            if let question = meta.question {
                StudioAnatomyQuestion(question: question, options: meta.options, answer: meta.answer) { answer in
                    thread.answer(answer, slot: slot)
                }
                .padding(.leading, 36)
            }
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            Rectangle().fill(StudioGlow.track).frame(height: 0.5).padding(.leading, 36)
        }
        .id("anatomy-\(slot)")
    }

    private func editor(slot: String) -> some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            HStack(alignment: .bottom, spacing: FBSpacing.xs) {
                TextField("Say how it works", text: $draftText, axis: .vertical)
                    .font(.fbBody)
                    .lineLimit(1...4)
                    .focused($focus, equals: .edit)
                    .padding(.horizontal, FBSpacing.m)
                    .padding(.vertical, 8)
                    .background(StudioGlow.fieldFill, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                VoiceInputButton(voice: editVoice, text: $draftText)
            }
            VoiceInputNote(voice: editVoice)
            HStack(spacing: FBSpacing.s) {
                Button("Cancel") {
                    withAnimation(.easeInOut(duration: 0.2)) { editingSlot = nil }
                }
                .buttonStyle(.studioSecondary(expand: false, height: 36))
                Button("Save") {
                    editVoice.stop()
                    Haptics.light()
                    thread.setText(draftText, slot: slot)
                    withAnimation(.easeInOut(duration: 0.2)) { editingSlot = nil }
                }
                .buttonStyle(.studioSecondary(expand: false, height: 36))
            }
        }
    }

    private var refineField: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            Text("Something off? Tell Muse")
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
            StudioAnatomyInput(
                placeholder: "Actually, you lose if two crowns touch",
                text: $refineText,
                isBusy: thread.isWorking,
                focus: $focus,
                field: .refine,
                accessibilityLabel: "Send to Muse"
            ) {
                let text = refineText
                refineText = ""
                focus = nil
                thread.refine(text)
            }
        }
        .padding(.top, FBSpacing.s)
    }
}

/// The line "How the game works" shows while the game builds.
struct StudioAnatomyBuildNote: Equatable {
    var text: String
    /// True once the person changed something the running build doesn't have.
    var isChange: Bool
}

// MARK: - Shared rows

/// One anatomy part: icon (or rule number), title, tags, the text, details, and how Muse plans
/// to build it when it isn't a known part.
struct StudioAnatomyPartRow: View {
    let title: String
    var symbol: String? = nil
    var number: Int? = nil
    let text: String
    var details: [String] = []
    let meta: AnatomyMeta
    var isHighlighted = false
    var showsPlan = true

    var body: some View {
        HStack(alignment: .top, spacing: FBSpacing.s) {
            badge
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.secondaryText)
                    Spacer(minLength: 4)
                    StudioAnatomyTag(source: meta.source)
                    StudioAnatomyTag(familiarity: meta.familiarity)
                }
                Text(text)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.primaryText)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(details.prefix(3), id: \.self) { line in
                    Text(line)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if showsPlan, meta.familiarity != .known, let plan = meta.planLine {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Image(systemName: "hammer")
                            .font(.system(size: FBIconSize.xs, weight: .semibold))
                        Text(plan)
                            .font(.fbMeta)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(FBColor.secondaryText)
                }
            }
        }
        .padding(isHighlighted ? FBSpacing.xs : 0)
        .background {
            if isHighlighted {
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                    .fill(GameColor.violet.opacity(0.18))
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var badge: some View {
        ZStack {
            Circle().fill(meta.familiarity == .unfamiliar ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(StudioGlow.fieldFill))
            Circle().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75)
            if let number {
                Text("\(number)")
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(meta.familiarity == .unfamiliar ? BubbleGlow.ink : FBColor.primaryText)
            } else if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                    .foregroundStyle(meta.familiarity == .unfamiliar ? BubbleGlow.ink : FBColor.secondaryText)
            }
        }
        .frame(width: 28, height: 28)
        .accessibilityHidden(true)
    }
}

/// A small tag: "You said" / "Muse guessed", or "Known" / "Approximate" / "New to Muse".
struct StudioAnatomyTag: View {
    let title: String
    let tint: Color
    var filled = false
    var symbol: String? = nil

    init(source: AnatomySource) {
        title = source.label
        tint = source == .you ? GameColor.sky : StudioGlow.offline
        filled = source == .you
    }

    init(familiarity: AnatomyFamiliarity) {
        title = familiarity.label
        switch familiarity {
        case .known:
            tint = StudioGlow.fixed
        case .approximate:
            tint = GameColor.periwinkle
        case .unfamiliar:
            tint = GameColor.violet
            filled = true
            symbol = "sparkle"
        }
    }

    var body: some View {
        HStack(spacing: 3) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 8, weight: .bold)) // Tiny tag glyph, sized to the micro text
            } else if !filled {
                Circle().fill(tint).frame(width: 6, height: 6)
            }
            Text(title)
                .font(.fbMicroEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(filled ? BubbleGlow.ink : FBColor.secondaryText)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(filled ? AnyShapeStyle(tint.opacity(0.85)) : AnyShapeStyle(StudioGlow.fieldFill), in: Capsule())
        .overlay(Capsule().strokeBorder(StudioGlow.cardStroke, lineWidth: 0.5))
        .fixedSize()
    }
}

/// Muse's question under a part, with quick answers and a field for anything else.
struct StudioAnatomyQuestion: View {
    let question: String
    let options: [String]
    let answer: String?
    let onAnswer: (String?) -> Void

    @State private var isTyping = false
    @State private var typed = ""

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: answer == nil ? "questionmark.bubble" : "checkmark.bubble")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(answer == nil ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(StudioGlow.fixed))
                Text(question)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            FlowLayout(spacing: FBSpacing.xs, lineSpacing: FBSpacing.xs) {
                ForEach(options, id: \.self) { option in
                    StudioChip(title: option, isSelected: answer == option) {
                        Haptics.selection()
                        onAnswer(answer == option ? nil : option)
                    }
                }
                if let answer, !options.contains(answer) {
                    StudioChip(title: answer, isSelected: true, trailingSymbol: "xmark") {
                        onAnswer(nil)
                    }
                } else if !isTyping {
                    StudioChip(title: "Something else", symbol: "pencil") {
                        Haptics.selection()
                        withAnimation(.easeInOut(duration: 0.2)) { isTyping = true }
                    }
                }
            }
            if isTyping {
                HStack(spacing: FBSpacing.s) {
                    TextField("Your answer", text: $typed)
                        .font(.fbBody)
                        .submitLabel(.done)
                        .onSubmit(commit)
                        .padding(.horizontal, FBSpacing.m)
                        .frame(minHeight: 36)
                        .background(StudioGlow.fieldFill, in: Capsule())
                    Button("Done", action: commit)
                        .font(.fbButton)
                        .foregroundStyle(FBColor.accent)
                        .frame(minHeight: 44)
                }
            }
        }
        .padding(FBSpacing.s)
        .background(StudioGlow.fieldFill.opacity(0.6), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    private func commit() {
        let value = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        typed = ""
        withAnimation(.easeInOut(duration: 0.2)) { isTyping = false }
        if !value.isEmpty { onAnswer(value) }
    }
}

/// A line in Muse's voice: small avatar and text.
struct StudioAnatomyMuseLine: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: FBSpacing.s) {
            StudioMuseAvatar(size: 24)
            Text(text)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, FBSpacing.m)
                .padding(.vertical, 8)
                .background(StudioGlow.fieldFill, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Muse: \(text)")
    }
}

/// A one-line composer with a send button, like the Tweak field.
struct StudioAnatomyInput<Field: Hashable>: View {
    let placeholder: String
    @Binding var text: String
    var isBusy = false
    var focus: FocusState<Field?>.Binding
    let field: Field
    let accessibilityLabel: String
    let onSend: () -> Void

    @State private var voice = VoiceInput()

    private var canSend: Bool {
        !isBusy && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            composer
            VoiceInputNote(voice: voice)
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: FBSpacing.s) {
            TextField(placeholder, text: $text, axis: .vertical)
                .font(.fbBody)
                .lineLimit(1...4)
                .focused(focus, equals: field)
                .submitLabel(.send)
                .onChange(of: text) { _, newValue in
                    if newValue.contains("\n") {
                        text = newValue.replacingOccurrences(of: "\n", with: " ")
                        if canSend {
                            voice.stop()
                            onSend()
                        }
                    }
                }
                .padding(.horizontal, FBSpacing.m)
                .padding(.vertical, 10)
                .background(StudioGlow.fieldFill, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
                        .strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75)
                }
            VoiceInputButton(voice: voice, text: $text)
            Button {
                guard canSend else { return }
                voice.stop()
                Haptics.light()
                onSend()
            } label: {
                Group {
                    if isBusy {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 34)) // Display glyph: the send button, sized like the Tweak field's
                            .foregroundStyle(canSend ? AnyShapeStyle(BubbleGlow.brandGradient) : AnyShapeStyle(FBColor.tertiaryText))
                    }
                }
                .frame(width: 44, height: 44)
            }
            .buttonStyle(.pressable)
            .disabled(!canSend)
            .accessibilityLabel(accessibilityLabel)
        }
    }
}
