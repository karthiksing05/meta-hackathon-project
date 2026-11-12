import SwiftUI

/// A "Games about me" template's form: 5–6 questions, prefilled with your answers (edit any,
/// blank skips it), plus your opted-in posts if you want Muse to read them. "Make it with Muse"
/// hands Studio the template id and answers (`StudioSocialContext.aboutMeTemplate/Answers`).
struct AboutMeFormSheet: View {
    let template: TogetherStudio.Template
    let onCreate: (String, StudioSocialContext) -> Void

    @Environment(AppStore.self) private var appStore

    @State private var answers: [String: String] = [:]
    @State private var usePosts = false
    @State private var didPrefill = false

    /// Your posts opted in to Bubbles. Only these may reach Muse.
    private var optedInPosts: [Post] {
        appStore.posts.filter { $0.author.isMe && $0.allowsBubbles && !$0.text.isEmpty }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                VStack(spacing: 0) {
                    ForEach(Array(template.questions.enumerated()), id: \.element.id) { index, question in
                        if index > 0 { HairlineDivider() }
                        questionRow(question)
                    }
                }
                .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                postsToggle
            }
            .padding(FBMetrics.screenPadding)
        }
        .background(FBColor.background)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { createBar }
        .navigationTitle(template.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: prefill)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(template.emoji)
                .font(.system(size: 30)) // Emoji glyph, sized to its tile
                .frame(width: 56, height: 56)
                .background(TogetherStyle.gradient.opacity(0.18), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(template.gameTitle(appStore.me.firstName))
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Text(TogetherCopy.editAnything)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func questionRow(_ question: TogetherStudio.AboutQuestion) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(question.label)
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
            TextField(question.sample, text: binding(question.id))
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityLabel(question.label)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var postsToggle: some View {
        let count = optedInPosts.count
        return VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: $usePosts) {
                Label(TogetherCopy.usePosts, systemImage: "text.bubble")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
            }
            .tint(FBColor.brandBlue)
            .disabled(count == 0)
            Text(TogetherCopy.usePostsDetail(count))
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .padding(12)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    private var createBar: some View {
        let answered = template.questions.filter { !(answers[$0.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }.count
        return VStack(spacing: 0) {
            HairlineDivider()
            Button(action: create) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                    Text(TogetherCopy.createWithMuse)
                }
                .font(.fbButton)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(TogetherStyle.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .opacity(answered >= 2 ? 1 : 0.45)
            }
            .buttonStyle(.plain)
            .disabled(answered < 2)
            .padding(FBMetrics.screenPadding)
            .accessibilityLabel(TogetherCopy.createWithMuse)
        }
        .background(FBColor.surface)
    }

    // MARK: Actions

    private func binding(_ id: String) -> Binding<String> {
        Binding(get: { answers[id] ?? "" }, set: { answers[id] = $0 })
    }

    /// Your answers start filled in for the demo (Alex's), so a template is two taps from a game.
    private func prefill() {
        guard !didPrefill else { return }
        didPrefill = true
        for question in template.questions where answers[question.id] == nil {
            answers[question.id] = question.sample
        }
    }

    private func create() {
        let me = appStore.me
        var filled = answers.compactMapValues { value -> String? in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : String(trimmed.prefix(32))
        }
        if usePosts {
            let text = optedInPosts.prefix(4).map(\.text).joined(separator: " · ")
            filled[TogetherStudio.postsKey] = String(text.prefix(400))
        }
        let social = StudioSocialContext(
            makers: [BubbleMaker(id: me.id, name: me.firstName, role: "starter", contribution: template.title)],
            aboutMeTemplate: template.id,
            aboutMeAnswers: filled
        )
        Haptics.success()
        onCreate(TogetherCopy.aboutMePrompt(template, name: me.firstName), social)
    }
}
