import SwiftUI

// MARK: - Icons

/// An SF Symbol in Facebook's default icon style.
struct SymbolIcon: View {
    let name: String
    var size: CGFloat = 17
    var weight: Font.Weight = .semibold
    var color: Color = FBColor.primaryText

    var body: some View {
        Image(systemName: name)
            .font(.system(size: size, weight: weight))
            .foregroundStyle(color)
    }
}

/// A white symbol on a colored circle, e.g. the badge on a notification avatar.
struct SymbolBadge: View {
    let symbol: String
    var color: Color = FBColor.brandBlue
    var size: CGFloat = 24

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(.white)
            }
    }
}

/// A gray circular header button (search, Messenger, settings) with an optional red badge.
struct CircleButton<Label: View>: View {
    var size: CGFloat
    var badge: Int
    var accessibilityText: String
    var action: () -> Void
    var label: Label

    init(
        size: CGFloat = 36,
        badge: Int = 0,
        accessibilityLabel: String,
        action: @escaping () -> Void,
        @ViewBuilder label: () -> Label
    ) {
        self.size = size
        self.badge = badge
        self.accessibilityText = accessibilityLabel
        self.action = action
        self.label = label()
    }

    var body: some View {
        Button(action: action) {
            label
                .frame(width: size, height: size)
                .background(FBColor.buttonGray, in: Circle())
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        BadgeCount(count: badge)
                            .offset(x: 6, y: -5)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityText)
    }
}

extension CircleButton where Label == SymbolIcon {
    init(
        symbol: String,
        size: CGFloat = 36,
        badge: Int = 0,
        accessibilityLabel: String,
        action: @escaping () -> Void
    ) {
        self.init(size: size, badge: badge, accessibilityLabel: accessibilityLabel, action: action) {
            SymbolIcon(name: symbol, size: size * 0.47)
        }
    }
}

/// Red count badge ("3", "99+").
struct BadgeCount: View {
    let count: Int

    var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 11, weight: .bold)) // Fixed so badges never outgrow their icon
            .foregroundStyle(.white)
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 18)
            .background(FBColor.notificationRed, in: Capsule())
            .overlay {
                Capsule().stroke(FBColor.surface, lineWidth: 2)
            }
            .accessibilityLabel("\(count) new")
    }
}

struct VerifiedBadge: View {
    var size: CGFloat = FBIconSize.small

    var body: some View {
        Image(systemName: "checkmark.seal.fill")
            .font(.system(size: size))
            .foregroundStyle(FBColor.brandBlue)
            .accessibilityLabel("Verified")
    }
}

/// A name followed by a verified badge when the account is verified.
struct NameWithBadge: View {
    let user: User
    var font: Font = .fbName

    var body: some View {
        HStack(spacing: 4) {
            Text(user.name)
                .font(font)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            if user.isVerified {
                VerifiedBadge()
            }
        }
    }
}

// MARK: - Buttons

/// Facebook's rounded-rectangle buttons ("Confirm", "Add friend", "Edit profile").
struct FBButtonStyle: ButtonStyle {
    enum Kind {
        /// Blue background, white text.
        case primary
        /// Gray background, dark text.
        case secondary
        /// Light blue background, blue text.
        case tinted
        /// Red background, white text.
        case destructive
        /// Clear background with a gray border.
        case outline
    }

    var kind: Kind = .primary
    var expand: Bool = true
    var height: CGFloat = 36

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.fbButton)
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .frame(maxWidth: expand ? .infinity : nil)
            .frame(height: height)
            .background(background, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
            .overlay {
                if kind == .outline {
                    RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous)
                        .stroke(FBColor.divider, lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch kind {
        case .primary, .destructive: return .white
        case .secondary, .outline: return FBColor.primaryText
        case .tinted: return FBColor.accent
        }
    }

    private var background: Color {
        switch kind {
        case .primary: return FBColor.brandBlue
        case .secondary: return FBColor.buttonGray
        case .tinted: return FBColor.tintedBlueBackground
        case .destructive: return FBColor.notificationRed
        case .outline: return .clear
        }
    }
}

extension ButtonStyle where Self == FBButtonStyle {
    static var fbPrimary: FBButtonStyle { FBButtonStyle(kind: .primary) }
    static var fbSecondary: FBButtonStyle { FBButtonStyle(kind: .secondary) }
    static var fbTinted: FBButtonStyle { FBButtonStyle(kind: .tinted) }

    static func fb(_ kind: FBButtonStyle.Kind, expand: Bool = true, height: CGFloat = 36) -> FBButtonStyle {
        FBButtonStyle(kind: kind, expand: expand, height: height)
    }
}

/// Shrinks slightly while pressed. Use for tappable cards and tiles.
struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.97

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
}

/// A rounded filter chip ("Suggestions", "Your friends", "For you").
struct ChipView: View {
    let title: String
    var symbol: String? = nil
    var isSelected: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: FBIconSize.medium, weight: .semibold))
                }
                Text(title)
                    .font(.fbButton)
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? FBColor.accent : FBColor.primaryText)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(isSelected ? FBColor.tintedBlueBackground : FBColor.buttonGray, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Dividers and headers

/// The thick gray bar between feed posts.
struct FeedSeparator: View {
    var body: some View {
        Rectangle()
            .fill(FBColor.feedSeparator)
            .frame(height: FBMetrics.feedSeparatorHeight)
    }
}

struct HairlineDivider: View {
    var leadingInset: CGFloat = 0

    var body: some View {
        Rectangle()
            .fill(FBColor.divider)
            .frame(height: 0.5)
            .padding(.leading, leadingInset)
    }
}

/// A section title with an optional subtitle and "See all" style action.
struct SectionHeader: View {
    let title: String
    var subtitle: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                if let subtitle {
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Spacer(minLength: 8)
            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// The big bold title row at the top of a tab, with trailing circle buttons.
struct TabHeader<Trailing: View>: View {
    let title: String
    let trailing: Trailing

    init(_ title: String, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.fbTabTitle)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.vertical, 8)
    }
}

extension TabHeader where Trailing == EmptyView {
    init(_ title: String) {
        self.init(title) { EmptyView() }
    }
}

// MARK: - Inputs

/// The rounded gray search field.
struct SearchField: View {
    let placeholder: String
    @Binding var text: String
    var autoFocus: Bool = false
    var onSubmit: () -> Void = {}

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: FBIconSize.medium, weight: .medium))
                .foregroundStyle(FBColor.secondaryText)
            TextField(placeholder, text: $text)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .focused($isFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit(onSubmit)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(FBColor.secondaryText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(FBColor.inputBackground, in: Capsule())
        .task {
            guard autoFocus else { return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            isFocused = true
        }
    }
}

/// "What's on your mind?" row. Opens the post composer.
struct ComposerBar: View {
    var placeholder: String = "What's on your mind?"
    var group: FBGroup? = nil
    var timelineOwner: User? = nil

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        HStack(spacing: 10) {
            Button {
                router.push(.profile(store.me))
            } label: {
                AvatarView(user: store.me, size: FBAvatarSize.post)
            }
            .buttonStyle(.plain)

            Button {
                router.composePost(CreatePostRequest(group: group, timelineOwner: timelineOwner))
            } label: {
                Text(placeholder)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .frame(height: 38)
                    .overlay {
                        Capsule().stroke(FBColor.divider, lineWidth: 1)
                    }
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)

            Button {
                router.composePost(CreatePostRequest(group: group, timelineOwner: timelineOwner, startAction: .photo))
            } label: {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: FBIconSize.xl))
                    .foregroundStyle(FBColor.photoGreen)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add photo")
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.vertical, 10)
        .background(FBColor.surface)
    }
}

// MARK: - Helpers

private struct FirstAppearModifier: ViewModifier {
    let action: () -> Void
    @State private var hasAppeared = false

    func body(content: Content) -> some View {
        content.onAppear {
            guard !hasAppeared else { return }
            hasAppeared = true
            action()
        }
    }
}

extension View {
    /// Runs `action` the first time the view appears only.
    func onFirstAppear(perform action: @escaping () -> Void) -> some View {
        modifier(FirstAppearModifier(action: action))
    }
}

/// Wraps subviews onto new lines, like text. Good for chips and tags.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
