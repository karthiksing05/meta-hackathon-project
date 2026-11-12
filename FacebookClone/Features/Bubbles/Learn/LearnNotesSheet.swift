import SwiftUI

/// "Make a lesson": a topic and optional pasted notes (docs/BUBBLES.md 7.8). Studio's Ask step and
/// the Group's "Learn together" card open it; `onSubmit` gets the trimmed topic and notes.
struct LearnNotesSheet: View {
    var initialTopic = ""
    var initialNotes = ""
    let onSubmit: (_ topic: String, _ notes: String) -> Void
    let onCancel: () -> Void

    @State private var topic = ""
    @State private var notes = ""
    @State private var didLoad = false
    @FocusState private var focus: Field?

    private enum Field { case topic, notes }

    private var trimmedTopic: String { topic.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedNotes: String { notes.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSubmit: Bool { !trimmedTopic.isEmpty || !trimmedNotes.isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(LearnStyle.gradient)
                            Image(systemName: "graduationcap.fill")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        .frame(width: 44, height: 44)
                        .accessibilityHidden(true)
                        Text(LearnCopy.studioEntrySubtitle)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(LearnCopy.topicLabel)
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.secondaryText)
                        TextField(LearnCopy.topicPlaceholder, text: $topic, axis: .vertical)
                            .font(.fbBodyLarge)
                            .lineLimit(1...3)
                            .focused($focus, equals: .topic)
                            .submitLabel(.next)
                            .padding(12)
                            .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                            .accessibilityLabel(LearnCopy.topicLabel)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(LearnCopy.notesLabel)
                                .font(.fbMetaEmphasized)
                                .foregroundStyle(FBColor.secondaryText)
                            Spacer()
                            Button(LearnCopy.sampleNotes) {
                                Haptics.selection()
                                if trimmedTopic.isEmpty { topic = LearnCopy.sampleTopic }
                                notes = LearnCopy.sampleNotesText
                            }
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.accent)
                        }
                        TextEditor(text: $notes)
                            .font(.fbBody)
                            .frame(minHeight: 160)
                            .scrollContentBackground(.hidden)
                            .padding(8)
                            .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                            .focused($focus, equals: .notes)
                            .accessibilityLabel(LearnCopy.notesLabel)
                        Text(LearnCopy.notesHelp)
                            .font(.fbCaption)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(FBMetrics.screenPadding)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(FBColor.surface)
            .navigationTitle(LearnCopy.notesSheetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(LearnCopy.cancel, action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(LearnCopy.makeIt) {
                        Haptics.success()
                        onSubmit(trimmedTopic, trimmedNotes)
                    }
                    .fontWeight(.semibold)
                    .disabled(!canSubmit)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            topic = initialTopic
            notes = initialNotes
            focus = .topic
        }
    }
}
