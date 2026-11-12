import SwiftUI

/// Post text with an inline "... See more" for long posts, plus #hashtags and @mentions
/// in the accent color. Tags are tappable links once the text is fully shown.
struct PostTextView: View {
    let text: String
    var startsExpanded: Bool = false
    var font: Font = .fbBody

    @State private var isExpanded = false

    private static let collapseThreshold = 260
    private static let collapsedLength = 200
    private static let collapsedLines = 4

    var body: some View {
        if isCollapsed {
            Text(collapsedString)
                .font(font)
                .foregroundStyle(FBColor.primaryText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded = true
                    }
                }
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Shows the whole post")
        } else {
            Text(PostRichText.make(text))
                .font(font)
                .foregroundStyle(FBColor.primaryText)
                .tint(FBColor.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var isCollapsed: Bool {
        !startsExpanded && !isExpanded && needsTruncation
    }

    private var needsTruncation: Bool {
        text.count > Self.collapseThreshold || lineCount > Self.collapsedLines + 1
    }

    private var lineCount: Int {
        text.reduce(1) { count, character in
            character == "\n" ? count + 1 : count
        }
    }

    /// The first few lines, cut at a word boundary.
    private var truncatedText: String {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        var candidate = lines.prefix(Self.collapsedLines).joined(separator: "\n")
        if candidate.count > Self.collapsedLength {
            candidate = String(candidate.prefix(Self.collapsedLength))
            if let space = candidate.lastIndex(where: { $0 == " " || $0 == "\n" }) {
                candidate = String(candidate[..<space])
            }
        }
        return candidate.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var collapsedString: AttributedString {
        var result = PostRichText.make(truncatedText, linked: false)
        result.append(AttributedString("... "))
        var more = AttributedString("See more")
        more.font = font.weight(.semibold)
        more.foregroundColor = FBColor.secondaryText
        result.append(more)
        return result
    }
}

/// A short text-only post on a colored background: big, bold and centered.
struct PostBackgroundText: View {
    let text: String
    let backgroundIndex: Int

    var body: some View {
        let background = PostBackground.preset(backgroundIndex)
        background.gradient
            .aspectRatio(1.1, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                Text(text)
                    .font(.system(size: fontSize, weight: .bold)) // Display text
                    .multilineTextAlignment(.center)
                    .foregroundStyle(background.textColor)
                    .minimumScaleFactor(0.5)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 24)
            }
            .accessibilityElement(children: .combine)
    }

    private var fontSize: CGFloat {
        switch text.count {
        case 0..<50: return 30
        case 50..<100: return 26
        default: return 22
        }
    }
}
