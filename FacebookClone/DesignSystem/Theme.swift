import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    /// A color that follows light and dark mode.
    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

/// Facebook's color tokens. Every token adapts to dark mode.
enum FBColor {
    /// The brand blue used for the logo and primary buttons.
    static let brandBlue = Color(hex: 0x0866FF)
    /// Links, selected tabs and other blue text.
    static let accent = Color.dynamic(light: 0x0866FF, dark: 0x4599FF)
    /// The "facebook" wordmark (white in dark mode).
    static let wordmark = Color.dynamic(light: 0x0866FF, dark: 0xE4E6EB)

    /// Cards, headers, the tab bar.
    static let surface = Color.dynamic(light: 0xFFFFFF, dark: 0x242526)
    /// Grouped screens behind cards (Menu, Settings).
    static let background = Color.dynamic(light: 0xF0F2F5, dark: 0x18191A)
    /// The thick bar between posts in the feed.
    static let feedSeparator = Color.dynamic(light: 0xCED0D4, dark: 0x0F0F10)
    static let elevated = Color.dynamic(light: 0xFFFFFF, dark: 0x3A3B3C)

    static let primaryText = Color.dynamic(light: 0x050505, dark: 0xE4E6EB)
    static let secondaryText = Color.dynamic(light: 0x65676B, dark: 0xB0B3B8)
    static let tertiaryText = Color.dynamic(light: 0x8A8D91, dark: 0x8A8D91)

    static let divider = Color.dynamic(light: 0xDADDE1, dark: 0x3E4042)
    /// Gray circle buttons and secondary buttons.
    static let buttonGray = Color.dynamic(light: 0xE4E6EB, dark: 0x3A3B3C)
    /// Text fields and the comment bubble.
    static let inputBackground = Color.dynamic(light: 0xF0F2F5, dark: 0x3A3B3C)
    /// Light blue behind blue text (selected chips, "Add friend" secondary buttons).
    static let tintedBlueBackground = Color.dynamic(light: 0xEBF5FF, dark: 0x263951)
    /// Unread notification rows.
    static let unreadBackground = Color.dynamic(light: 0xE7F3FF, dark: 0x1F2E43)
    static let skeleton = Color.dynamic(light: 0xE4E6EB, dark: 0x3A3B3C)

    static let online = Color(hex: 0x31A24C)
    static let notificationRed = Color(hex: 0xE41E3F)
    static let liveRed = Color(hex: 0xF02849)
    static let photoGreen = Color(hex: 0x45BD62)
    static let feelingYellow = Color(hex: 0xF7B928)
    static let tagBlue = Color(hex: 0x1877F2)
    static let checkInRed = Color(hex: 0xF5533D)
    static let reelsPink = Color(hex: 0xE42D6F)
    static let groupsBlue = Color(hex: 0x1B74E4)
    static let eventRed = Color(hex: 0xF3425F)
    static let marketplaceTeal = Color(hex: 0x00A3A3)
    static let memoriesBlue = Color(hex: 0x2ABBA7)
    static let savedPurple = Color(hex: 0x8C4FFF)
    static let pollOrange = Color(hex: 0xF5A623)

    /// Messenger bubbles.
    static let incomingBubble = Color.dynamic(light: 0xF0F0F0, dark: 0x303030)
    static let messengerBlue = Color(hex: 0x0A7CFF)

    /// The dark snackbar behind toasts (same in both modes).
    static let toastBackground = Color(hex: 0x303031)
    /// Always-dark canvases: story creator, story viewer chrome, calls.
    static let darkCanvas = Color(hex: 0x18191A)
}

/// Layout constants. See docs/STYLE_GUIDE.md for when to use each.
enum FBMetrics {
    /// Horizontal padding inside posts, comments and feed modules.
    static let gutter: CGFloat = 12
    /// Horizontal padding at screen edges for headers, lists and settings.
    static let screenPadding: CGFloat = 16
    /// Height of the gray bar between feed posts.
    static let feedSeparatorHeight: CGFloat = 6
    /// Buttons, text fields, thumbnails. Same as `radiusMedium`.
    static let cornerRadius: CGFloat = 8

    /// Progress bars, reply-quote bars, tiny tags.
    static let radiusXS: CGFloat = 4
    /// Badges, small chips that aren't capsules, inline media in rows.
    static let radiusSmall: CGFloat = 6
    /// Buttons, inputs, thumbnails, listing photos.
    static let radiusMedium: CGFloat = 8
    /// Cards, tiles, story cards, grouped sections, sheets' inner cards.
    static let radiusLarge: CGFloat = 12
    /// Comment and chat bubbles, large pills.
    static let radiusXL: CGFloat = 18
}

/// Spacing scale (4-point grid, plus 6 and 10 which Facebook uses for tight rows).
enum FBSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

/// Avatar diameters. Pick by context, not by eye.
enum FBAvatarSize {
    /// Read receipts.
    static let micro: CGFloat = 16
    /// Overlapping stacks (mutual friends, members, reactors).
    static let tiny: CGFloat = 20
    /// Comment replies, chat bubbles.
    static let reply: CGFloat = 28
    /// Top-level comments, chat header.
    static let comment: CGFloat = 32
    /// Stories tray, compact headers.
    static let story: CGFloat = 36
    /// Post headers, composer bar, search results, menu profile row.
    static let post: CGFloat = 40
    /// Marketplace seller rows, two-line search results.
    static let compact: CGFloat = 48
    /// People lists, Messenger chats list, notifications, reactions list, logged-out account card.
    static let row: CGFloat = 60
    /// Friend requests and People You May Know rows.
    static let request: CGFloat = 80
    /// Call screen, chat info.
    static let hero: CGFloat = 120
    /// Profile page.
    static let profile: CGFloat = 168
}

/// SF Symbol point sizes. Icons use `.font(.system(size: FBIconSize.x, weight:))`.
enum FBIconSize {
    /// Inline glyphs inside 11-12 pt text (audience globe, chevrons in captions).
    static let xs: CGFloat = 11
    /// Inline glyphs inside 13-15 pt text.
    static let small: CGFloat = 13
    /// Icons inside chips and buttons.
    static let medium: CGFloat = 15
    /// Default: header buttons, action bars, list row icons.
    static let regular: CGFloat = 17
    /// Prominent row icons, composer tools.
    static let large: CGFloat = 20
    /// Tab bar, Reels action column.
    static let xl: CGFloat = 22
    /// Hero icons (empty states, call controls).
    static let xxl: CGFloat = 28
}

extension Font {
    /// Big bold titles at the top of tabs ("Friends", "Marketplace") and profile names (26 pt).
    static let fbTabTitle = Font.system(size: 26, weight: .bold)
    /// Messenger's "Chats" title and other extra-large screen titles (28 pt).
    static let fbLargeTitle = Font.system(size: 28, weight: .bold)
    /// Section titles ("Friend requests", "Today's picks") (20 pt bold).
    static let fbTitle = Font.title3.weight(.bold)
    /// Card titles, sheet titles, emphasized rows (17 pt semibold).
    static let fbHeadline = Font.headline
    /// Names in post headers and rows (15 pt semibold).
    static let fbName = Font.subheadline.weight(.semibold)
    /// Post text and most body copy (15 pt).
    static let fbBody = Font.subheadline
    /// Larger body copy, text fields (17 pt).
    static let fbBodyLarge = Font.body
    /// Timestamps, counts and secondary details (13 pt).
    static let fbMeta = Font.footnote
    /// Emphasized metadata ("See all", counts with weight) (13 pt semibold).
    static let fbMetaEmphasized = Font.footnote.weight(.semibold)
    /// Small labels under tiles and thumbnails (12 pt).
    static let fbCaption = Font.caption
    /// Emphasized small labels, pill text (12 pt semibold).
    static let fbCaptionEmphasized = Font.caption.weight(.semibold)
    /// Smallest text: durations, tiny counters (11 pt).
    static let fbMicro = Font.caption2
    /// Badges, LIVE pills, overlay counters (11 pt semibold).
    static let fbMicroEmphasized = Font.caption2.weight(.semibold)
    /// Button labels (15 pt semibold).
    static let fbButton = Font.subheadline.weight(.semibold)
}

extension ReactionType {
    /// Color for the reaction's label, e.g. the "Love" text on a post's action bar.
    var color: Color {
        switch self {
        case .like: return Color(hex: 0x0866FF)
        case .love: return Color(hex: 0xF33E58)
        case .angry: return Color(hex: 0xE9710F)
        case .care, .haha, .wow, .sad: return Color(hex: 0xF7B125)
        }
    }
}

extension Conversation {
    var themeColor: Color { Color(hex: themeHex) }
}

/// Backgrounds for short text posts and text stories.
struct PostBackground: Identifiable {
    let id: Int
    let colors: [Color]
    var textColor: Color = .white

    var gradient: LinearGradient {
        LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static let presets: [PostBackground] = [
        PostBackground(id: 0, colors: [Color(hex: 0xC600FF), Color(hex: 0x8A00D4)]),
        PostBackground(id: 1, colors: [Color(hex: 0xF5576C), Color(hex: 0xF093FB)]),
        PostBackground(id: 2, colors: [Color(hex: 0x0866FF), Color(hex: 0x00C6FF)]),
        PostBackground(id: 3, colors: [Color(hex: 0xFF8008), Color(hex: 0xFFC837)]),
        PostBackground(id: 4, colors: [Color(hex: 0x11998E), Color(hex: 0x38EF7D)]),
        PostBackground(id: 5, colors: [Color(hex: 0x232526), Color(hex: 0x414345)]),
        PostBackground(id: 6, colors: [Color(hex: 0xE52D27), Color(hex: 0xB31217)]),
        PostBackground(id: 7, colors: [Color(hex: 0x4E54C8), Color(hex: 0x8F94FB)]),
        PostBackground(id: 8, colors: [Color(hex: 0xFFE259), Color(hex: 0xFFA751)], textColor: Color(hex: 0x050505)),
        PostBackground(id: 9, colors: [Color(hex: 0xFC466B), Color(hex: 0x3F5EFB)]),
        PostBackground(id: 10, colors: [Color(hex: 0x00B09B), Color(hex: 0x96C93D)]),
        PostBackground(id: 11, colors: [Color(hex: 0xF7F8F8), Color(hex: 0xDCDFE4)], textColor: Color(hex: 0x050505)),
    ]

    /// Wraps any index (including negative ones) into the preset list.
    static func preset(_ index: Int) -> PostBackground {
        let count = presets.count
        return presets[((index % count) + count) % count]
    }
}
