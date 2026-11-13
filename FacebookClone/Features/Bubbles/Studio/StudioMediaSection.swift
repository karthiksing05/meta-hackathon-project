import PhotosUI
import SwiftUI

/// "Add photos or video" on Describe, styled like "Add sound". Opens the Photos picker.
struct StudioMediaAddButton: View {
    let media: StudioMediaModel
    @State private var selection: [PhotosPickerItem] = []

    var body: some View {
        PhotosPicker(selection: $selection, maxSelectionCount: max(1, media.remainingSlots),
                     selectionBehavior: .ordered, matching: media.pickerFilter, preferredItemEncoding: .compatible) {
            Label("Add photos or video", systemImage: "photo.on.rectangle.angled")
                .font(.fbMetaEmphasized)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(FBColor.inputBackground, in: Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(FBColor.primaryText)
        .disabled(!media.canAddMore)
        .accessibilityHint("Up to \(StudioMediaModel.maxPhotos) photos and \(StudioMediaModel.maxVideos) video of up to a minute")
        .onChange(of: selection) { _, picked in
            guard !picked.isEmpty else { return }
            Haptics.light()
            withAnimation(.easeInOut(duration: 0.2)) { media.add(picked) }
            selection = []
        }
    }
}

/// The picked photos and video: a strip of thumbnails (each with its upload progress, remove and
/// retry), what the game should do with them, and the restyle switch.
struct StudioMediaSection: View {
    @Bindable var media: StudioMediaModel
    @FocusState private var isNoteFocused: Bool
    @State private var selection: [PhotosPickerItem] = []

    static let tileSide: CGFloat = 72

    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.m) {
            HStack(alignment: .firstTextBaseline) {
                Text("Your photos and video")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: FBSpacing.s)
                Text(countText)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            strip
            if let message = statusText {
                Text(message)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
            Text("What should the game do with these?")
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.bottom, -FBSpacing.xs)
            TextField("\u{201C}Make a quiz from this clip\u{201D}, \u{201C}use my dog as the hero\u{201D}", text: $media.note, axis: .vertical)
                .font(.fbBody)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1...3)
                .focused($isNoteFocused)
                .submitLabel(.done)
                .padding(.horizontal, FBSpacing.m)
                .padding(.vertical, 10)
                .background(StudioGlow.fieldFill, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .onChange(of: media.note) { _, value in
                    if value.contains("\n") {
                        media.note = value.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
                        isNoteFocused = false
                    } else if value.count > GameMediaInput.maxNoteCharacters {
                        media.note = String(value.prefix(GameMediaInput.maxNoteCharacters))
                    }
                }
            Toggle(isOn: $media.restyle) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Restyle my photos into the game\u{2019}s look")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Muse redraws them in the game\u{2019}s art style")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            .tint(FBColor.brandBlue)
            .onChange(of: media.restyle) { Haptics.light() }
        }
        .studioCard(padding: FBSpacing.m, radius: FBMetrics.radiusLarge)
        .animation(.easeInOut(duration: 0.2), value: media.notice)
    }

    private var strip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: FBSpacing.s) {
                ForEach(media.items) { item in
                    StudioMediaTile(item: item, side: Self.tileSide,
                                    onRemove: { withAnimation(.easeInOut(duration: 0.2)) { media.remove(item.id) } },
                                    onRetry: { media.retry(item.id) })
                        .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
                if media.canAddMore {
                    addTile
                }
            }
            // Room for the remove buttons that sit over the corners.
            .padding(.top, 6)
            .padding(.trailing, 6)
        }
        .padding(.top, -6)
    }

    private var addTile: some View {
        PhotosPicker(selection: $selection, maxSelectionCount: max(1, media.remainingSlots),
                     selectionBehavior: .ordered, matching: media.pickerFilter, preferredItemEncoding: .compatible) {
            VStack(spacing: FBSpacing.xs) {
                Image(systemName: "plus")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                Text("Add")
                    .font(.fbCaptionEmphasized)
            }
            .foregroundStyle(FBColor.secondaryText)
            .frame(width: Self.tileSide, height: Self.tileSide)
            .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                    .strokeBorder(FBColor.divider, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add more photos or video")
        .onChange(of: selection) { _, picked in
            guard !picked.isEmpty else { return }
            Haptics.light()
            withAnimation(.easeInOut(duration: 0.2)) { media.add(picked) }
            selection = []
        }
    }

    private var countText: String {
        var parts: [String] = []
        if media.photoCount > 0 { parts.append(media.photoCount == 1 ? "1 photo" : "\(media.photoCount) photos") }
        if media.videoCount > 0 { parts.append(media.videoCount == 1 ? "1 video" : "\(media.videoCount) videos") }
        return parts.joined(separator: " · ")
    }

    /// The notice (trimmed video, picks left out), or what's still uploading.
    private var statusText: String? {
        if let notice = media.notice { return notice }
        let working = media.items.filter(\.isWorking).count
        if working > 0 { return working == 1 ? "Uploading 1 item\u{2026}" : "Uploading \(working) items\u{2026}" }
        return nil
    }
}

/// One picked photo or video: the thumbnail, a progress ring while it converts and uploads, a
/// retry state when it failed, the video's length, and a remove button.
private struct StudioMediaTile: View {
    let item: StudioMediaModel.Item
    let side: CGFloat
    let onRemove: () -> Void
    let onRetry: () -> Void

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous) }

    var body: some View {
        ZStack {
            thumbnail
            overlay
        }
        .frame(width: side, height: side)
        .clipShape(shape)
        .overlay(shape.strokeBorder(StudioGlow.cardStroke, lineWidth: 0.75))
        .overlay(alignment: .bottomLeading) {
            if item.kind == .video, let seconds = item.durationSeconds, !isFailed {
                durationBadge(seconds)
                    .padding(FBSpacing.xs)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 22, height: 22)
                    .background(Color.black.opacity(0.7), in: Circle())
                    .overlay(Circle().strokeBorder(.white, lineWidth: 1.5))
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .offset(x: 9, y: -9)
            .accessibilityLabel(item.kind == .video ? "Remove video" : "Remove photo")
        }
        .contentShape(shape)
        .onTapGesture { if isFailed { onRetry() } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityText)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let image = item.thumbnail {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: side, height: side)
        } else {
            FBColor.skeleton
                .overlay {
                    Image(systemName: item.kind == .video ? "video" : "photo")
                        .font(.system(size: FBIconSize.medium))
                        .foregroundStyle(FBColor.tertiaryText)
                }
        }
    }

    @ViewBuilder
    private var overlay: some View {
        switch item.phase {
        case .preparing:
            Color.black.opacity(0.35)
            ProgressView()
                .tint(.white)
        case .uploading(let fraction):
            Color.black.opacity(0.35)
            StudioMediaProgressRing(fraction: fraction)
        case .uploaded:
            EmptyView()
        case .failed(let message):
            Color.black.opacity(0.55)
            VStack(spacing: 2) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: FBIconSize.medium, weight: .bold))
                Text("Retry")
                    .font(.fbMicroEmphasized)
            }
            .foregroundStyle(.white)
            .accessibilityLabel("\(message). Retry")
            .accessibilityAddTraits(.isButton)
        }
    }

    private func durationBadge(_ seconds: Double) -> some View {
        HStack(spacing: 2) {
            Image(systemName: "play.fill")
                .font(.system(size: 7, weight: .bold))
            Text(Self.duration(seconds))
                .font(.fbMicroEmphasized)
                .monospacedDigit()
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(Color.black.opacity(0.6), in: Capsule())
    }

    private var isFailed: Bool {
        if case .failed = item.phase { return true }
        return false
    }

    static func duration(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private var accessibilityText: String {
        let kind = item.kind == .video ? "Video" : "Photo"
        switch item.phase {
        case .preparing: return "\(kind), getting ready"
        case .uploading(let fraction): return "\(kind), uploading, \(Int(fraction * 100)) percent"
        case .uploaded: return "\(kind), uploaded"
        case .failed(let message): return "\(kind), \(message)"
        }
    }
}

/// A white ring that fills as the upload goes.
private struct StudioMediaProgressRing: View {
    let fraction: Double

    var body: some View {
        ZStack {
            Circle()
                .stroke(.white.opacity(0.3), lineWidth: 3)
            Circle()
                .trim(from: 0, to: max(0.03, min(fraction, 1)))
                .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.15), value: fraction)
        }
        .frame(width: 28, height: 28)
    }
}
