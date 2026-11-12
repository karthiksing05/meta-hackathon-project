import SwiftUI

enum AvatarRing: Equatable {
    case none
    /// Blue ring for an unseen story, gray once seen.
    case story(seen: Bool)
}

/// A round profile picture with optional story ring and green "active now" dot.
/// Falls back to colored initials while loading or offline.
struct AvatarView: View {
    let user: User
    var size: CGFloat = 40
    var showsOnline: Bool = false
    var ring: AvatarRing = .none

    var body: some View {
        ZStack {
            initials
            RemoteImage(url: user.avatarURL, data: user.avatarData, placeholder: .clear)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay {
            Circle().stroke(Color.black.opacity(0.06), lineWidth: 0.5)
        }
        .padding(ringInset)
        .overlay {
            ringOverlay
        }
        .overlay(alignment: .bottomTrailing) {
            if showsOnline && user.isOnline {
                Circle()
                    .fill(FBColor.online)
                    .frame(width: dotSize, height: dotSize)
                    .overlay {
                        Circle().stroke(FBColor.surface, lineWidth: max(2, size * 0.06))
                    }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(user.name)
    }

    private var initials: some View {
        Circle()
            .fill(AvatarView.color(for: user.id))
            .overlay {
                Text(user.initials)
                    .font(.system(size: size * 0.38, weight: .semibold))
                    .foregroundStyle(.white)
            }
    }

    private var ringLineWidth: CGFloat { max(2, size * 0.05) }

    private var ringInset: CGFloat {
        ring == .none ? 0 : ringLineWidth + max(1.5, size * 0.04)
    }

    private var dotSize: CGFloat { max(10, size * 0.28) }

    @ViewBuilder
    private var ringOverlay: some View {
        switch ring {
        case .none:
            EmptyView()
        case .story(let seen):
            Circle().strokeBorder(seen ? FBColor.divider : FBColor.brandBlue, lineWidth: ringLineWidth)
        }
    }

    private static let palette: [Color] = [
        Color(hex: 0x0866FF), Color(hex: 0x45BD62), Color(hex: 0xF7B928), Color(hex: 0xF3425F),
        Color(hex: 0x8C4FFF), Color(hex: 0x2ABBA7), Color(hex: 0xE9710F), Color(hex: 0x1B74E4),
    ]

    static func color(for id: String) -> Color {
        let index = Int(SeededGenerator.stableHash(id) % UInt64(palette.count))
        return palette[index]
    }
}

/// Small overlapping avatars, e.g. mutual friends or group members.
struct AvatarStack: View {
    let users: [User]
    var size: CGFloat = 20
    var maxCount: Int = 3

    var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(Array(users.prefix(maxCount).enumerated()), id: \.element.id) { index, user in
                AvatarView(user: user, size: size)
                    .overlay {
                        Circle().stroke(FBColor.surface, lineWidth: 1.5)
                    }
                    .zIndex(Double(maxCount - index))
            }
        }
    }
}
