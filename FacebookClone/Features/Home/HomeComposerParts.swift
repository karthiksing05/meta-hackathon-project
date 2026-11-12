import SwiftUI

/// Sheets the composer can show.
enum HomeComposerSheet: String, Identifiable {
    case audience
    case feeling
    case tagPeople
    case checkIn
    case tools

    var id: String { rawValue }
}

/// Everything in "Add to your post".
enum HomeComposerTool: String, CaseIterable, Identifiable, Hashable {
    case photo
    case tagPeople
    case feeling
    case checkIn
    case background
    case poll
    case live
    case camera
    case lifeEvent

    var id: String { rawValue }

    /// The icons shown in the collapsed bar.
    static let barTools: [HomeComposerTool] = [.photo, .tagPeople, .feeling, .checkIn, .background, .poll]

    var title: String {
        switch self {
        case .photo: return "Photo/video"
        case .tagPeople: return "Tag people"
        case .feeling: return "Feeling/activity"
        case .checkIn: return "Check in"
        case .background: return "Background color"
        case .poll: return "Poll"
        case .live: return "Live video"
        case .camera: return "Camera"
        case .lifeEvent: return "Life event"
        }
    }

    var symbol: String {
        switch self {
        case .photo: return "photo.on.rectangle.angled"
        case .tagPeople: return "person.fill.badge.plus"
        case .feeling: return "face.smiling"
        case .checkIn: return "mappin.circle.fill"
        case .background: return "textformat"
        case .poll: return "chart.bar.fill"
        case .live: return "video.fill"
        case .camera: return "camera.fill"
        case .lifeEvent: return "flag.fill"
        }
    }

    var color: Color {
        switch self {
        case .photo: return FBColor.photoGreen
        case .tagPeople: return FBColor.tagBlue
        case .feeling: return FBColor.feelingYellow
        case .checkIn: return FBColor.checkInRed
        case .background: return FBColor.savedPurple
        case .poll: return FBColor.pollOrange
        case .live: return FBColor.liveRed
        case .camera: return FBColor.groupsBlue
        case .lifeEvent: return FBColor.memoriesBlue
        }
    }
}

// MARK: - Chips

/// Light blue chip under the author name ("Friends ▾", "+ Album ▾").
struct HomeComposerChip: View {
    let symbol: String
    let title: String
    var showsChevron: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                Text(title)
                    .font(.fbMetaEmphasized)
                    .lineLimit(1)
                if showsChevron {
                    Image(systemName: "chevron.down")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                }
            }
            .foregroundStyle(FBColor.accent)
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(FBColor.tintedBlueBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Tools bar

/// "Add to your post" with colored tool icons. Tap the title or swipe up for the full list.
struct HomeComposerToolsBar: View {
    let activeTools: Set<HomeComposerTool>
    let onSelect: (HomeComposerTool) -> Void
    let onExpand: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(FBColor.divider)
                .frame(width: 36, height: 4)
                .padding(.top, 6)
            HStack(spacing: 0) {
                Button(action: onExpand) {
                    Text("Add to your post")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .buttonStyle(.plain)
                Spacer(minLength: 4)
                ForEach(HomeComposerTool.barTools) { tool in
                    Button {
                        onSelect(tool)
                    } label: {
                        HomeComposerToolIcon(tool: tool, isActive: activeTools.contains(tool))
                            .frame(width: 32, height: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tool.title)
                }
                Button(action: onExpand) {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.system(size: FBIconSize.xl))
                        .foregroundStyle(FBColor.secondaryText)
                        .frame(width: 32, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("More options")
            }
            .padding(.horizontal, 12)
            .frame(height: 48)
        }
        .background(FBColor.surface)
        .overlay(alignment: .top) {
            HairlineDivider()
        }
        .gesture(
            DragGesture(minimumDistance: 12)
                .onEnded { value in
                    if value.translation.height < -20 {
                        onExpand()
                    }
                }
        )
    }
}

struct HomeComposerToolIcon: View {
    let tool: HomeComposerTool
    var isActive: Bool = false
    var size: CGFloat = 22

    var body: some View {
        icon
            .overlay(alignment: .bottomTrailing) {
                if isActive {
                    Circle()
                        .fill(FBColor.brandBlue)
                        .frame(width: 8, height: 8)
                        .overlay {
                            Circle().stroke(FBColor.surface, lineWidth: 1.5)
                        }
                        .offset(x: 3, y: 3)
                }
            }
    }

    @ViewBuilder
    private var icon: some View {
        if tool == .background {
            Text("Aa")
                .font(.system(size: size * 0.55, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: size + 2, height: size + 2)
                .background(HomeComposerToolIcon.rainbow, in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
        } else {
            Image(systemName: tool.symbol)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(tool.color)
        }
    }

    static var rainbow: LinearGradient {
        LinearGradient(
            colors: [Color(hex: 0x00C6FF), Color(hex: 0xC600FF), Color(hex: 0xF5576C)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Background swatches

/// "Aa" toggle plus the row of text post backgrounds. The first swatch means no background.
struct HomeBackgroundSwatchRow: View {
    @Binding var selection: Int?
    @Binding var isExpanded: Bool
    var onChange: () -> Void = {}

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button {
                    Haptics.selection()
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    toggleLabel
                }
                .buttonStyle(.plain)
                .accessibilityLabel(toggleAccessibilityText)

                if isExpanded {
                    Button {
                        choose(nil)
                    } label: {
                        noneSwatch
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("No background")

                    ForEach(PostBackground.presets) { preset in
                        Button {
                            choose(preset.id)
                        } label: {
                            swatch(preset)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Background \(preset.id + 1)")
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }

    private var toggleAccessibilityText: String {
        isExpanded ? "Hide backgrounds" : "Show backgrounds"
    }

    @ViewBuilder
    private var toggleLabel: some View {
        if isExpanded {
            Image(systemName: "chevron.left")
                .font(.system(size: FBIconSize.medium, weight: .bold))
                .foregroundStyle(FBColor.primaryText)
                .frame(width: 34, height: 34)
                .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        } else {
            Text("Aa")
                .font(.fbButton)
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(HomeComposerToolIcon.rainbow, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
        }
    }

    private var noneSwatch: some View {
        RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
            .fill(FBColor.surface)
            .frame(width: 34, height: 34)
            .overlay {
                RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                    .stroke(FBColor.divider, lineWidth: 1)
            }
            .overlay {
                if selection == nil {
                    selectionRing
                }
            }
    }

    private func swatch(_ preset: PostBackground) -> some View {
        RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
            .fill(preset.gradient)
            .frame(width: 34, height: 34)
            .overlay {
                if selection == preset.id {
                    selectionRing
                }
            }
    }

    private var selectionRing: some View {
        RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
            .stroke(FBColor.accent, lineWidth: 2.5)
            .padding(-3)
    }

    private func choose(_ index: Int?) {
        Haptics.selection()
        withAnimation(.easeInOut(duration: 0.2)) {
            selection = index
        }
        onChange()
    }
}

// MARK: - Poll

struct HomePollDraftOption: Identifiable, Equatable {
    let id = UUID()
    var title: String = ""
}

/// 2 to 4 option fields with add and remove.
struct HomePollEditor: View {
    @Binding var options: [HomePollDraftOption]
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Poll", systemImage: "chart.bar.fill")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: FBIconSize.small, weight: .bold))
                        .foregroundStyle(FBColor.primaryText)
                        .frame(width: 28, height: 28)
                        .background(FBColor.buttonGray, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove poll")
            }
            ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                HStack(spacing: 8) {
                    TextField("Option \(index + 1)", text: binding(for: option.id))
                        .font(.fbBody)
                        .foregroundStyle(FBColor.primaryText)
                        .padding(.horizontal, 12)
                        .frame(height: 40)
                        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                    if options.count > 2 {
                        Button {
                            remove(option.id)
                        } label: {
                            Image(systemName: "minus.circle.fill")
                                .font(.system(size: FBIconSize.large))
                                .foregroundStyle(FBColor.secondaryText)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove option")
                    }
                }
            }
            if options.count < 4 {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        options.append(HomePollDraftOption())
                    }
                } label: {
                    Label("Add option", systemImage: "plus")
                        .font(.fbButton)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .overlay {
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .stroke(FBColor.divider, lineWidth: 1)
        }
    }

    private func binding(for id: UUID) -> Binding<String> {
        Binding(
            get: { options.first(where: { $0.id == id })?.title ?? "" },
            set: { newValue in
                if let index = options.firstIndex(where: { $0.id == id }) {
                    options[index].title = newValue
                }
            }
        )
    }

    private func remove(_ id: UUID) {
        withAnimation(.easeInOut(duration: 0.2)) {
            options.removeAll { $0.id == id }
        }
    }
}

// MARK: - Media

/// Picked (or existing) photos. Pass `onRemove` to show × buttons.
struct HomeComposerMediaGrid: View {
    let media: [Media]
    var isLoading: Bool = false
    var onRemove: ((Media) -> Void)? = nil

    private var columns: [GridItem] {
        let count = media.count <= 1 && !isLoading ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: 4), count: count)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: 4) {
            ForEach(media) { item in
                tile(item)
            }
            if isLoading {
                RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                    .fill(FBColor.skeleton)
                    .frame(height: 170)
                    .overlay {
                        ProgressView()
                    }
                    .shimmering()
            }
        }
    }

    @ViewBuilder
    private func tile(_ item: Media) -> some View {
        if media.count == 1 && !isLoading {
            RemoteImage(url: item.url, data: item.data)
                .aspectRatio(CGFloat(max(item.aspectRatio, 0.6)), contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    removeButton(for: item)
                }
                .overlay {
                    videoBadge(for: item)
                }
        } else {
            RemoteImage(url: item.url, data: item.data)
                .frame(height: 170)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    removeButton(for: item)
                }
                .overlay {
                    videoBadge(for: item)
                }
        }
    }

    @ViewBuilder
    private func removeButton(for item: Media) -> some View {
        if let onRemove {
            Button {
                onRemove(item)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: FBIconSize.small, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(Color.black.opacity(0.55), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(6)
            .accessibilityLabel("Remove photo")
        }
    }

    @ViewBuilder
    private func videoBadge(for item: Media) -> some View {
        if item.kind == .video {
            Image(systemName: "play.fill")
                .font(.system(size: FBIconSize.regular, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Color.black.opacity(0.45), in: Circle())
        }
    }
}

// MARK: - Shared post preview

/// The original post embedded under the text of a "Share > Write post" post.
struct HomeSharedPostPreview: View {
    let post: Post

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    AvatarView(user: post.author, size: FBAvatarSize.comment)
                    VStack(alignment: .leading, spacing: 1) {
                        NameWithBadge(user: post.author)
                        HStack(spacing: 3) {
                            Text(post.createdAt.fbShort)
                            Text("·")
                            Image(systemName: post.audience.symbol)
                                .font(.system(size: FBIconSize.xs))
                        }
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                    }
                }
                if !post.text.isEmpty && !post.showsBackground {
                    Text(post.text)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(4)
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(12)
            preview
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .stroke(FBColor.divider, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var preview: some View {
        if let item = post.media.first {
            RemoteImage(url: item.url, data: item.data)
                .frame(height: 200)
                .frame(maxWidth: .infinity)
                .clipped()
                .overlay {
                    if item.kind == .video {
                        Image(systemName: "play.fill")
                            .font(.system(size: FBIconSize.large, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 48, height: 48)
                            .background(Color.black.opacity(0.45), in: Circle())
                    }
                }
        } else if post.showsBackground, let index = post.backgroundIndex {
            HomeTextStoryCanvas(text: post.text, backgroundIndex: index, fontSize: 22)
                .frame(height: 180)
        } else if let link = post.link {
            VStack(alignment: .leading, spacing: 2) {
                if link.imageURL != nil {
                    RemoteImage(url: link.imageURL)
                        .frame(height: 150)
                        .frame(maxWidth: .infinity)
                        .clipped()
                }
                Text(link.domain.uppercased())
                    .font(.fbCaption)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                Text(link.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            }
            .background(FBColor.inputBackground)
        }
    }
}
