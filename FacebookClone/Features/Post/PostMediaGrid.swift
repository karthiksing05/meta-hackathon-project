import SwiftUI

/// Facebook's photo layouts: one photo at its own shape (clamped 4:5 ... 1.91:1),
/// two side by side, three as one large plus two, four as a 2x2 grid, and five or
/// more as two on top and three below with a "+N" overlay. A single video autoplays.
struct PostMediaGrid: View {
    /// The post the media belongs to. Videos use it to open Reels.
    var post: Post?
    let media: [Media]
    var isSuspended: Bool = false
    /// False inside a shared-post box, where the whole box is one link.
    var isInteractive: Bool = true
    var onOpen: (Int) -> Void = { _ in }

    private static let gap: CGFloat = 2

    var body: some View {
        if let only = media.first, media.count == 1 {
            single(only)
        } else if media.count > 1 {
            grid
        }
    }

    // MARK: One item

    @ViewBuilder
    private func single(_ item: Media) -> some View {
        if item.kind == .video, item.videoURL != nil, isInteractive {
            PostVideoView(media: item, post: post, isSuspended: isSuspended)
        } else {
            cell(item, index: 0)
                .aspectRatio(Self.clampedRatio(item.aspectRatio), contentMode: .fit)
                .frame(maxWidth: .infinity)
        }
    }

    /// Width / height, kept between 4:5 and 1.91:1 like the real feed.
    static func clampedRatio(_ ratio: Double) -> CGFloat {
        guard ratio.isFinite, ratio > 0 else { return 1 }
        return CGFloat(min(max(ratio, 0.8), 1.91))
    }

    // MARK: Grids

    private var grid: some View {
        Color.clear
            .aspectRatio(gridRatio, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                GeometryReader { proxy in
                    layout(in: proxy.size)
                }
            }
    }

    private var gridRatio: CGFloat {
        switch media.count {
        case 2: return isStackedPair ? 1 : 1.25
        case 3, 4: return 1
        default: return 1.2
        }
    }

    /// Two landscape photos stack instead of sitting side by side.
    private var isStackedPair: Bool {
        media.count == 2 && media.allSatisfy { $0.aspectRatio >= 1.2 }
    }

    /// With three photos, a landscape first photo goes on top; otherwise on the left.
    private var isLandscapeLead: Bool {
        (media.first?.aspectRatio ?? 1) >= 1.2
    }

    @ViewBuilder
    private func layout(in size: CGSize) -> some View {
        let gap = Self.gap
        let width = size.width
        let height = size.height
        let halfWidth = (width - gap) / 2
        let halfHeight = (height - gap) / 2
        switch media.count {
        case 2:
            if isStackedPair {
                VStack(spacing: gap) {
                    cell(media[0], index: 0).frame(width: width, height: halfHeight)
                    cell(media[1], index: 1).frame(width: width, height: halfHeight)
                }
            } else {
                HStack(spacing: gap) {
                    cell(media[0], index: 0).frame(width: halfWidth, height: height)
                    cell(media[1], index: 1).frame(width: halfWidth, height: height)
                }
            }
        case 3:
            if isLandscapeLead {
                let topHeight = height * 0.6
                VStack(spacing: gap) {
                    cell(media[0], index: 0).frame(width: width, height: topHeight)
                    HStack(spacing: gap) {
                        cell(media[1], index: 1).frame(width: halfWidth, height: height - topHeight - gap)
                        cell(media[2], index: 2).frame(width: halfWidth, height: height - topHeight - gap)
                    }
                }
            } else {
                let leadWidth = width * 0.62
                HStack(spacing: gap) {
                    cell(media[0], index: 0).frame(width: leadWidth, height: height)
                    VStack(spacing: gap) {
                        cell(media[1], index: 1).frame(width: width - leadWidth - gap, height: halfHeight)
                        cell(media[2], index: 2).frame(width: width - leadWidth - gap, height: halfHeight)
                    }
                }
            }
        case 4:
            VStack(spacing: gap) {
                HStack(spacing: gap) {
                    cell(media[0], index: 0).frame(width: halfWidth, height: halfHeight)
                    cell(media[1], index: 1).frame(width: halfWidth, height: halfHeight)
                }
                HStack(spacing: gap) {
                    cell(media[2], index: 2).frame(width: halfWidth, height: halfHeight)
                    cell(media[3], index: 3).frame(width: halfWidth, height: halfHeight)
                }
            }
        case 5...:
            let topHeight = halfWidth
            let thirdWidth = (width - gap * 2) / 3
            let bottomHeight = height - topHeight - gap
            VStack(spacing: gap) {
                HStack(spacing: gap) {
                    cell(media[0], index: 0).frame(width: halfWidth, height: topHeight)
                    cell(media[1], index: 1).frame(width: halfWidth, height: topHeight)
                }
                HStack(spacing: gap) {
                    cell(media[2], index: 2).frame(width: thirdWidth, height: bottomHeight)
                    cell(media[3], index: 3).frame(width: thirdWidth, height: bottomHeight)
                    cell(media[4], index: 4, extra: media.count - 5).frame(width: thirdWidth, height: bottomHeight)
                }
            }
        default:
            EmptyView()
        }
    }

    // MARK: Cells

    @ViewBuilder
    private func cell(_ item: Media, index: Int, extra: Int = 0) -> some View {
        if isInteractive {
            Button {
                onOpen(index)
            } label: {
                PostMediaTile(media: item, extraCount: extra)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityText(for: item, index: index))
        } else {
            PostMediaTile(media: item, extraCount: extra)
        }
    }

    private func accessibilityText(for item: Media, index: Int) -> String {
        let kind = item.kind == .video ? "Video" : "Photo"
        return "\(kind) \(index + 1) of \(media.count)"
    }
}

/// One photo (or video poster) in a grid, with an optional "+N" overlay.
struct PostMediaTile: View {
    let media: Media
    var extraCount: Int = 0

    var body: some View {
        RemoteImage(url: media.url, data: media.data)
            .overlay {
                if media.kind == .video {
                    PostPlayGlyph(size: 44)
                }
            }
            .overlay {
                if extraCount > 0 {
                    ZStack {
                        Color.black.opacity(0.45)
                        Text("+\(extraCount)")
                            .font(.system(size: 30, weight: .semibold)) // Display text
                            .foregroundStyle(.white)
                    }
                }
            }
            .clipped()
            .contentShape(Rectangle())
    }
}

/// The round play button drawn over video posters.
struct PostPlayGlyph: View {
    var size: CGFloat = 56

    var body: some View {
        Image(systemName: "play.fill")
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(.white)
            .offset(x: size * 0.04)
            .frame(width: size, height: size)
            .background(Color.black.opacity(0.45), in: Circle())
            .overlay {
                Circle().stroke(Color.white.opacity(0.9), lineWidth: 2)
            }
            .accessibilityHidden(true)
    }
}
