import SwiftUI

/// "Change the game" on the Try step: a short chat with Muse about how the game works. Each message
/// is first mapped onto the agreed anatomy ("This changes rule 2 and how it ends"), with the
/// updated parts and anything new to Muse, and the person makes the change with one tap; the
/// tweak path then rebuilds the game with the updated anatomy (docs/BUBBLES.md 7.13).
struct StudioAnatomyChatCard: View {
    let model: StudioModel

    @State private var text = ""
    @FocusState private var field: Field?

    private enum Field: Hashable { case message }

    private var thread: StudioAnatomyThread { model.anatomyThread }

    private static let suggestions = ["Make it harder", "Add a time limit", "A new way to lose", "Fewer tries"]

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            StudioSectionTitle(title: "Change the game", detail: "Muse edits the rules", symbol: "bubble.left.and.text.bubble.right")
            chat
        }
        .studioCard()
    }

    @ViewBuilder
    private var chat: some View {
            if thread.turns.isEmpty {
                Text("Say what to change: a rule, how you win or lose, the timing. Muse shows which parts it changes before it rebuilds.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(thread.turns) { turn in
                StudioAnatomyTurnView(turn: turn, anatomy: thread.anatomy, isComposing: model.isComposing,
                                      onMake: { model.makeAnatomyChange(turn.id) },
                                      onDismiss: { thread.dismiss(turn.id) },
                                      onMakeAsWritten: { model.makeChangeAsWritten(turn.id) })
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            StudioAnatomyInput(
                placeholder: "Actually, you lose if two crowns touch",
                text: $text,
                isBusy: thread.isMapping || model.isComposing,
                focus: $field,
                field: .message,
                accessibilityLabel: "Send to Muse"
            ) {
                let message = text
                text = ""
                field = nil
                thread.proposeChange(message)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: FBSpacing.s) {
                    ForEach(Self.suggestions, id: \.self) { suggestion in
                        StudioChip(title: suggestion, symbol: "sparkle") {
                            Haptics.selection()
                            text = suggestion
                        }
                    }
                }
                .padding(.vertical, 2)
            }
    }
}

/// One exchange: the person's words, then Muse's mapping and the updated parts.
private struct StudioAnatomyTurnView: View {
    let turn: StudioAnatomyThread.Turn
    let anatomy: GameAnatomy?
    let isComposing: Bool
    let onMake: () -> Void
    let onDismiss: () -> Void
    let onMakeAsWritten: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            HStack {
                Spacer(minLength: 48)
                Text(turn.ask)
                    .font(.fbBody)
                    .foregroundStyle(BubbleGlow.ink)
                    .padding(.horizontal, FBSpacing.m)
                    .padding(.vertical, 8)
                    .background(BubbleGlow.brandGradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("You: \(turn.ask)")
            }
            switch turn.status {
            case .mapping:
                HStack(spacing: FBSpacing.s) {
                    ProgressView()
                    Text("Muse is matching that to the game's parts…")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                .padding(.leading, 32)
            case .failed(let message):
                StudioAnatomyMuseLine(text: message)
                if !isComposing {
                    Button("Make it as written", action: onMakeAsWritten)
                        .buttonStyle(.studioSecondary(expand: false, height: 36))
                        .padding(.leading, 32)
                }
            default:
                if let reply = turn.reply {
                    StudioAnatomyMuseLine(text: reply)
                }
                if let proposed = turn.proposed, !turn.slots.isEmpty {
                    updatedParts(proposed)
                        .padding(.leading, 32)
                }
                footer
                    .padding(.leading, 32)
            }
        }
    }

    private func updatedParts(_ proposed: GameAnatomy) -> some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            ForEach(turn.slots, id: \.self) { slot in
                if let rule = proposed.rules.first(where: { $0.id == slot }) {
                    StudioAnatomyPartRow(title: "Rule \(rule.n)", number: rule.n, text: rule.text, meta: rule.meta, isHighlighted: true)
                } else if let part = proposed.parts.first(where: { $0.id == slot }) {
                    StudioAnatomyPartRow(title: part.key.title, symbol: part.key.symbol, text: part.text, details: part.details, meta: part.meta, isHighlighted: true)
                } else {
                    Text("Removed \(proposed.label(slot: slot))")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        switch turn.status {
        case .proposed:
            HStack(spacing: FBSpacing.s) {
                Button {
                    Haptics.light()
                    onMake()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                        Text("Make the change")
                    }
                }
                .buttonStyle(.studioSecondary(expand: false, height: 36))
                .disabled(isComposing)
                Button("Not quite") {
                    Haptics.selection()
                    onDismiss()
                }
                .buttonStyle(.studioSecondary(expand: false, height: 36))
            }
        case .applied:
            Label("Changed. Play it above.", systemImage: "checkmark.circle.fill")
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
        case .dismissed:
            Text("Not made")
                .font(.fbMeta)
                .foregroundStyle(FBColor.tertiaryText)
        default:
            EmptyView()
        }
    }
}
