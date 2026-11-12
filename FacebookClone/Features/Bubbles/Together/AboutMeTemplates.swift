import SwiftUI

// "Games about me" (docs/BUBBLES.md 7.4): the three templates and the picker. The templates'
// questions, decoys and sample answers live in `TogetherStudio` (Foundation only), because Muse
// Studio's offline composer turns the answers into rounds.

enum AboutMeTemplates {
    static var all: [TogetherStudio.Template] { TogetherStudio.templates }

    static func template(_ id: String?) -> TogetherStudio.Template? {
        id.flatMap(TogetherStudio.template)
    }
}

/// The about-me sheet: the template picker, or straight to one template's form.
struct AboutMeFlow: View {
    var templateID: String?
    /// Called with the Studio prompt and social context when the person taps "Make it with Muse".
    let onCreate: (String, StudioSocialContext) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let template = AboutMeTemplates.template(templateID) {
                    AboutMeFormSheet(template: template, onCreate: create)
                } else {
                    AboutMeTemplatePicker()
                }
            }
            .navigationDestination(for: AboutMeTemplateChoice.self) { choice in
                if let template = AboutMeTemplates.template(choice.id) {
                    AboutMeFormSheet(template: template, onCreate: create)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TogetherCopy.cancel) { dismiss() }
                }
            }
        }
    }

    private func create(_ prompt: String, _ social: StudioSocialContext) {
        dismiss()
        onCreate(prompt, social)
    }
}

/// A template picked in the picker (its own type so it doesn't collide with other String routes).
struct AboutMeTemplateChoice: Hashable {
    let id: String
}

/// Three templates: How well do you know me?, My first month in SF, Guess my favorite spot.
struct AboutMeTemplatePicker: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    TogetherBadge(symbol: "person.crop.circle.badge.questionmark", size: 48)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(TogetherCopy.aboutMeTitle)
                            .font(.fbTitle)
                            .foregroundStyle(FBColor.primaryText)
                        Text(TogetherCopy.aboutMeSubtitle)
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                ForEach(AboutMeTemplates.all) { template in
                    NavigationLink(value: AboutMeTemplateChoice(id: template.id)) {
                        AboutMeTemplateRow(template: template)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel(template.title)
                }
            }
            .padding(FBMetrics.screenPadding)
        }
        .background(FBColor.background)
        .navigationTitle(TogetherCopy.chooseTemplate)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One template as a tappable row.
struct AboutMeTemplateRow: View {
    let template: TogetherStudio.Template
    var compact = false

    var body: some View {
        HStack(spacing: 12) {
            Text(template.emoji)
                .font(.system(size: compact ? 22 : 28)) // Emoji glyph, sized to its tile
                .frame(width: compact ? 40 : 52, height: compact ? 40 : 52)
                .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(template.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(TogetherCopy.templateSubtitle(template.id))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(FBColor.tertiaryText)
        }
        .padding(compact ? 10 : 12)
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }
}
