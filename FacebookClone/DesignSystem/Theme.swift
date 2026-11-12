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

    /// Messenger bubbles.
    static let incomingBubble = Color.dynamic(light: 0xF0F0F0, dark: 0x303030)
    static let messengerBlue = Color(hex: 0x0A7CFF)
}

/// Spacing used across the app.
enum FBMetrics {
    /// Horizontal padding inside posts and rows.
    static let gutter: CGFloat = 12
    /// Height of the gray bar between feed posts.
    static let feedSeparatorHeight: CGFloat = 6
    static let cornerRadius: CGFloat = 8
}

extension Font {
    /// Big bold titles at the top of tabs ("Friends", "Marketplace").
    static let fbTabTitle = Font.system(size: 26, weight: .bold)
    static let fbTitle = Font.title3.weight(.bold)
    static let fbHeadline = Font.headline
    /// Names in post headers and rows.
    static let fbName = Font.subheadline.weight(.semibold)
    /// Post text and most body copy (15 pt).
    static let fbBody = Font.subheadline
    /// Larger body copy (17 pt).
    static let fbBodyLarge = Font.body
    /// Timestamps, counts and secondary details (13 pt).
    static let fbMeta = Font.footnote
    static let fbCaption = Font.caption
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
