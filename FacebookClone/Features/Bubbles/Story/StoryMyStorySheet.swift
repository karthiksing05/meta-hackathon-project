import SwiftUI

/// "Turn your story into an adventure" (docs/BUBBLES.md 7.6): you tell Muse about your first week
/// (a trip, a big day) and it becomes an adventure your new friends play. Inside Studio it fills
/// the open Studio (`model`); anywhere else (`FB_OPEN=feature:story/mystory`) it opens Studio with
/// the story in `StudioLaunch.social.personalStory`.
struct StoryMyStorySheet: View {
    /// The open Studio, when the sheet comes from Studio's Ask step.
    let model: StudioModel?

    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var isFocused: Bool

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canMake: Bool { trimmed.count >= 20 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: BubbleCategory.adventure.symbol)
                            .font(.system(size: FBIconSize.large, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Self.iconGradient, in: Circle())
                            .accessibilityHidden(true)
                        Text(StoryCopy.myStoryIntro)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ZStack(alignment: .topLeading) {
                        if text.isEmpty {
                            Text(StoryCopy.myStoryPlaceholder)
                                .font(.fbBodyLarge)
                                .foregroundStyle(FBColor.tertiaryText)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 8)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                        TextEditor(text: $text)
                            .font(.fbBodyLarge)
                            .foregroundStyle(FBColor.primaryText)
                            .scrollContentBackground(.hidden)
                            .focused($isFocused)
                            .frame(minHeight: 160)
                            .accessibilityLabel(StoryCopy.myStoryTitle)
                    }
                    .padding(8)
                    .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))

                    HStack {
                        Button {
                            Haptics.selection()
                            text = StoryCopy.myStoryExample
                        } label: {
                            Label(StoryCopy.myStoryUseExample, systemImage: "text.badge.plus")
                        }
                        .buttonStyle(.fb(.secondary, expand: false, height: 32))
                        Spacer()
                        Text("\(trimmed.count)/1200")
                            .font(.fbMicro.monospacedDigit())
                            .foregroundStyle(trimmed.count > 1200 ? FBColor.notificationRed : FBColor.tertiaryText)
                            .accessibilityHidden(true)
                    }

                    Label {
                        Text(StoryCopy.myStoryPrivacy)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "lock.fill")
                            .font(.system(size: FBIconSize.small))
                            .foregroundStyle(FBColor.secondaryText)
                    }

                    Button(action: make) {
                        Label(StoryCopy.myStoryMake, systemImage: "sparkles")
                    }
                    .buttonStyle(.fb(.primary, height: 44))
                    .disabled(!canMake)
                    .opacity(canMake ? 1 : 0.5)
                }
                .padding(FBMetrics.screenPadding)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(FBColor.surface)
            .navigationTitle(StoryCopy.myStoryTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(StoryCopy.cancel) { dismiss() }
                        .font(.fbButton)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
            if let story = model?.social?.personalStory, text.isEmpty { text = story }
        }
    }

    /// Facebook blue to purple.
    static let iconGradient = LinearGradient(colors: [FBColor.brandBlue, FBColor.savedPurple], startPoint: .topLeading, endPoint: .bottomTrailing)

    private func make() {
        guard canMake else { return }
        Haptics.success()
        let story = String(trimmed.prefix(1200))
        if let model {
            var social = model.social ?? StudioSocialContext()
            social.personalStory = story
            model.social = social
            model.formulaHint = .story
            if model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                model.prompt = StoryCopy.myStoryPrompt
            }
            dismiss()
            return
        }
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            router.openStudio(StudioLaunch(
                mode: .create,
                prompt: StoryCopy.myStoryPrompt,
                social: StudioSocialContext(personalStory: story)
            ))
        }
    }
}
