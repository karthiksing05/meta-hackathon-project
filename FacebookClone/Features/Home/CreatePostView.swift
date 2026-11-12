import PhotosUI
import SwiftUI
import UIKit

/// The post composer (full-screen cover). Creates posts, group posts, timeline posts and
/// "Share > Write post" posts, or edits an existing post.
struct CreatePostView: View {
    let request: CreatePostRequest

    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store

    @State private var text: String
    @State private var audience: Audience
    @State private var feeling: Feeling?
    @State private var location: String?
    @State private var taggedUsers: [User]
    @State private var backgroundIndex: Int?
    @State private var media: [Media] = []
    @State private var showsSwatches = false
    @State private var isPollEnabled = false
    @State private var pollOptions: [HomePollDraftOption] = [HomePollDraftOption(), HomePollDraftOption()]
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isPhotoPickerPresented = false
    @State private var isLoadingPhotos = false
    @State private var activeSheet: HomeComposerSheet? = nil
    @State private var showsDiscardDialog = false
    @State private var didStart = false
    @FocusState private var isEditorFocused: Bool

    /// What the composer opened with, to tell whether anything changed.
    private let original: HomeComposerSnapshot

    init(request: CreatePostRequest) {
        self.request = request
        let post = request.editingPost
        let draft = HomeComposerDraft.applies(to: request) ? HomeComposerDraft.load() : nil
        let initialText = post?.text ?? draft ?? ""
        let initialAudience = post?.audience ?? .friends
        let initialTags = post?.taggedUsers ?? []
        _text = State(initialValue: initialText)
        _audience = State(initialValue: initialAudience)
        _feeling = State(initialValue: post?.feeling)
        _location = State(initialValue: post?.location)
        _taggedUsers = State(initialValue: initialTags)
        _backgroundIndex = State(initialValue: post?.backgroundIndex)
        original = HomeComposerSnapshot(
            text: initialText,
            audience: initialAudience,
            feelingID: post?.feeling?.id,
            location: post?.location,
            taggedIDs: initialTags.map { $0.id },
            backgroundIndex: post?.backgroundIndex
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            HairlineDivider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    authorRow
                    editor
                    if supportsBackground {
                        HomeBackgroundSwatchRow(selection: $backgroundIndex, isExpanded: $showsSwatches) {
                            focusEditor()
                        }
                    }
                    attachments
                }
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HomeComposerToolsBar(
                    activeTools: activeTools,
                    onSelect: { tool in open(tool) },
                    onExpand: { activeSheet = .tools }
                )
            }
        }
        .background(FBColor.surface.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 64)
        }
        .photosPicker(
            isPresented: $isPhotoPickerPresented,
            selection: $photoSelection,
            maxSelectionCount: remainingPhotoSlots,
            selectionBehavior: .ordered,
            matching: .images
        )
        .onChange(of: photoSelection) { _, items in
            loadPhotos(items)
        }
        .sheet(item: $activeSheet) { sheet in
            sheetContent(sheet)
        }
        .confirmationDialog(dialogTitle, isPresented: $showsDiscardDialog, titleVisibility: .visible) {
            dialogButtons
        } message: {
            Text(dialogMessage)
        }
        .task {
            await start()
        }
    }

    // MARK: Derived state

    private var isEditing: Bool { request.editingPost != nil }

    private var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filledPollOptions: [String] {
        pollOptions
            .map { $0.title.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private var isPollValid: Bool { filledPollOptions.count >= 2 }

    private var editingHasMedia: Bool {
        guard let post = request.editingPost else { return false }
        return !post.media.isEmpty || post.sharedPost != nil
    }

    private var hasContent: Bool {
        if !trimmedText.isEmpty || !media.isEmpty { return true }
        if isPollEnabled && isPollValid { return true }
        if request.sharedPost != nil || editingHasMedia { return true }
        return feeling != nil || location != nil
    }

    private var canSubmit: Bool {
        hasContent && !isLoadingPhotos && (!isPollEnabled || isPollValid)
    }

    private var snapshot: HomeComposerSnapshot {
        HomeComposerSnapshot(
            text: text,
            audience: audience,
            feelingID: feeling?.id,
            location: location,
            taggedIDs: taggedUsers.map { $0.id },
            backgroundIndex: backgroundIndex
        )
    }

    private var isDirty: Bool {
        if snapshot != original || !media.isEmpty { return true }
        return isPollEnabled && !filledPollOptions.isEmpty
    }

    /// Colored backgrounds work for short text-only posts (< 130 characters, 3 lines at most).
    private var supportsBackground: Bool {
        if let post = request.editingPost {
            guard post.media.isEmpty, post.link == nil, post.sharedPost == nil, post.poll == nil else { return false }
        }
        guard media.isEmpty, !isPollEnabled, request.sharedPost == nil else { return false }
        guard text.count < 130, !text.lowercased().contains("http") else { return false }
        return text.components(separatedBy: "\n").count <= 3
    }

    private var effectiveBackgroundIndex: Int? {
        supportsBackground ? backgroundIndex : nil
    }

    private var usesLargeText: Bool {
        media.isEmpty && !isPollEnabled && request.sharedPost == nil && !editingHasMedia && text.count < 85
    }

    private var remainingPhotoSlots: Int { max(1, 10 - media.count) }

    private var activeTools: Set<HomeComposerTool> {
        var tools = Set<HomeComposerTool>()
        if !media.isEmpty { tools.insert(.photo) }
        if !taggedUsers.isEmpty { tools.insert(.tagPeople) }
        if feeling != nil { tools.insert(.feeling) }
        if location != nil { tools.insert(.checkIn) }
        if effectiveBackgroundIndex != nil { tools.insert(.background) }
        if isPollEnabled { tools.insert(.poll) }
        return tools
    }

    private var screenTitle: String { isEditing ? "Edit post" : "Create post" }

    private var submitTitle: String { isEditing ? "Save" : "Post" }

    private var placeholder: String {
        if request.sharedPost != nil { return "Say something about this..." }
        if let owner = request.timelineOwner { return "Write something to \(owner.firstName)..." }
        if request.group != nil { return "Write something..." }
        return "What's on your mind?"
    }

    private var draftPoll: Poll? {
        guard isPollEnabled, isPollValid else { return nil }
        return Poll(options: filledPollOptions.map { PollOption(title: $0) })
    }

    // MARK: Top bar and header

    private var topBar: some View {
        HStack(spacing: 10) {
            Button {
                attemptDismiss()
            } label: {
                Image(systemName: "arrow.left")
                    .font(.system(size: FBIconSize.large, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")

            Text(screenTitle)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)

            Spacer(minLength: 8)

            Button(submitTitle) {
                submit()
            }
            .buttonStyle(.fb(canSubmit ? .primary : .secondary, expand: false, height: 32))
            .disabled(!canSubmit)
            .opacity(canSubmit ? 1 : 0.6)
        }
        .padding(.horizontal, 10)
        .frame(height: 52)
    }

    private var authorRow: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(user: store.me, size: FBAvatarSize.post)
            VStack(alignment: .leading, spacing: 6) {
                headerLine
                    .font(.fbBody)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                contextChips
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
    }

    /// "Jordan Lee — feeling 😊 happy with Maria and 2 others at Ocean Beach".
    private var headerLine: Text {
        var line = Text(store.me.name).fontWeight(.semibold)
        let details = headerDetails
        guard !details.isEmpty else { return line }
        line = line + Text(" — ")
        for (index, part) in details.enumerated() {
            if index > 0 {
                line = line + Text(" ")
            }
            line = line + part
        }
        return line
    }

    private var headerDetails: [Text] {
        var parts: [Text] = []
        if let feeling {
            let emoji = Text("feeling \(feeling.emoji) ")
            parts.append(emoji + Text(feeling.name).fontWeight(.semibold))
        }
        if !taggedUsers.isEmpty {
            parts.append(Text("with ") + Text(taggedSummary).fontWeight(.semibold))
        }
        if let location {
            parts.append(Text("at ") + Text(location).fontWeight(.semibold))
        }
        return parts
    }

    private var taggedSummary: String {
        guard let first = taggedUsers.first else { return "" }
        switch taggedUsers.count {
        case 1:
            return first.name
        case 2:
            return "\(first.name) and \(taggedUsers[1].name)"
        default:
            return "\(first.name) and \(taggedUsers.count - 1) others"
        }
    }

    @ViewBuilder
    private var contextChips: some View {
        if let group = request.group {
            HStack(spacing: 4) {
                Image(systemName: group.privacySymbol)
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                Text("Posting in \(group.name)")
                    .font(.fbMeta)
                    .lineLimit(1)
            }
            .foregroundStyle(FBColor.secondaryText)
        } else if let owner = request.timelineOwner {
            HStack(spacing: 4) {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                Text("Writing on \(owner.firstName)'s profile")
                    .font(.fbMeta)
                    .lineLimit(1)
            }
            .foregroundStyle(FBColor.secondaryText)
        } else {
            HStack(spacing: 6) {
                HomeComposerChip(symbol: audience.symbol, title: audience.title) {
                    activeSheet = .audience
                }
                if !isEditing {
                    HomeComposerChip(symbol: "plus", title: "Album") {
                        store.showToast("Albums aren't available in this demo", symbol: "rectangle.stack.fill")
                    }
                }
            }
        }
    }

    // MARK: Editor

    @ViewBuilder
    private var editor: some View {
        if let index = effectiveBackgroundIndex {
            backgroundEditor(index)
        } else {
            TextField(placeholder, text: $text, axis: .vertical)
                .font(.system(size: usesLargeText ? 22 : 17))
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(3...)
                .focused($isEditorFocused)
                .padding(.horizontal, 16)
        }
    }

    private func backgroundEditor(_ index: Int) -> some View {
        let palette = PostBackground.preset(index)
        return ZStack {
            palette.gradient
            if text.isEmpty {
                Text(placeholder)
                    .font(.system(size: 28, weight: .bold)) // Display text
                    .foregroundStyle(palette.textColor.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .padding(24)
                    .allowsHitTesting(false)
            }
            TextField("", text: $text, axis: .vertical)
                .font(.system(size: 28, weight: .bold)) // Display text
                .foregroundStyle(palette.textColor)
                .tint(palette.textColor)
                .multilineTextAlignment(.center)
                .lineLimit(1...6)
                .focused($isEditorFocused)
                .padding(24)
        }
        .aspectRatio(1, contentMode: .fit)
        .contentShape(Rectangle())
        .onTapGesture {
            isEditorFocused = true
        }
    }

    @ViewBuilder
    private var attachments: some View {
        if isPollEnabled {
            HomePollEditor(options: $pollOptions) {
                removePoll()
            }
            .padding(.horizontal, 16)
        }
        if !media.isEmpty || isLoadingPhotos {
            HomeComposerMediaGrid(
                media: media,
                isLoading: isLoadingPhotos,
                onRemove: { item in removeMedia(item) }
            )
            .padding(.horizontal, 12)
            if media.count < 10 && !isLoadingPhotos {
                Button {
                    openPhotoPicker()
                } label: {
                    Label("Add more photos", systemImage: "photo.on.rectangle.angled")
                }
                .buttonStyle(.fb(.secondary))
                .padding(.horizontal, 16)
            }
        }
        if let post = request.editingPost {
            if !post.media.isEmpty {
                HomeComposerMediaGrid(media: post.media)
                    .padding(.horizontal, 12)
            }
            if let shared = post.sharedPost {
                HomeSharedPostPreview(post: shared)
                    .padding(.horizontal, 16)
            }
        }
        if let shared = request.sharedPost {
            HomeSharedPostPreview(post: shared.sharedPost ?? shared)
                .padding(.horizontal, 16)
        }
    }

    // MARK: Sheets and dialogs

    @ViewBuilder
    private func sheetContent(_ sheet: HomeComposerSheet) -> some View {
        switch sheet {
        case .audience:
            HomeAudienceSheet(selection: $audience)
        case .feeling:
            HomeFeelingPicker(selection: $feeling)
        case .tagPeople:
            HomeTagPeopleSheet(selection: $taggedUsers)
        case .checkIn:
            HomeCheckInSheet(selection: $location)
        case .tools:
            HomeComposerToolsSheet(activeTools: activeTools) { tool in
                activeSheet = nil
                Task {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    open(tool)
                }
            }
        }
    }

    private var dialogTitle: String {
        isEditing ? "Discard your changes?" : "Save this post as a draft?"
    }

    private var dialogMessage: String {
        isEditing ? "Your edits to this post won't be saved." : "If you discard now, you'll lose this post."
    }

    @ViewBuilder
    private var dialogButtons: some View {
        if isEditing {
            Button("Discard changes", role: .destructive) {
                dismiss()
            }
        } else {
            Button("Save as draft") {
                saveDraft()
            }
            Button("Discard post", role: .destructive) {
                discard()
            }
        }
        Button("Continue editing", role: .cancel) {}
    }

    // MARK: Tools

    @MainActor
    private func start() async {
        guard !didStart else { return }
        didStart = true
        try? await Task.sleep(nanoseconds: 450_000_000)
        switch request.startAction {
        case .none:
            focusEditor()
        case .photo:
            openPhotoPicker()
        case .feeling:
            activeSheet = .feeling
        case .tagPeople:
            activeSheet = .tagPeople
        case .checkIn:
            activeSheet = .checkIn
        case .background:
            openBackgrounds()
        case .poll:
            if !isPollEnabled {
                togglePoll()
            }
        }
    }

    private func open(_ tool: HomeComposerTool) {
        Haptics.light()
        switch tool {
        case .photo:
            openPhotoPicker()
        case .tagPeople:
            activeSheet = .tagPeople
        case .feeling:
            activeSheet = .feeling
        case .checkIn:
            activeSheet = .checkIn
        case .background:
            openBackgrounds()
        case .poll:
            togglePoll()
        case .live:
            store.showToast("Live video isn't available in this demo", symbol: "video.fill")
        case .camera:
            store.showToast("The camera isn't available in this demo", symbol: "camera.fill")
        case .lifeEvent:
            store.showToast("Life events aren't available in this demo", symbol: "flag.fill")
        }
    }

    private func focusEditor() {
        isEditorFocused = true
    }

    private func openPhotoPicker() {
        if isEditing {
            store.showToast("Photos can't be changed while editing", symbol: "photo")
            return
        }
        if isPollEnabled {
            store.showToast("Remove the poll to add photos", symbol: "chart.bar.fill")
            return
        }
        guard media.count < 10 else {
            store.showToast("You can add up to 10 photos", symbol: "photo.on.rectangle.angled")
            return
        }
        isEditorFocused = false
        isPhotoPickerPresented = true
    }

    private func openBackgrounds() {
        guard supportsBackground else {
            store.showToast("Backgrounds work with short text-only posts", symbol: "textformat")
            return
        }
        withAnimation(.easeInOut(duration: 0.2)) {
            showsSwatches = true
        }
        focusEditor()
    }

    private func togglePoll() {
        if isEditing {
            store.showToast("Polls can't be added while editing", symbol: "chart.bar.fill")
            return
        }
        if isPollEnabled {
            removePoll()
            return
        }
        guard media.isEmpty else {
            store.showToast("Remove your photos to add a poll", symbol: "chart.bar.fill")
            return
        }
        withAnimation(.easeInOut(duration: 0.2)) {
            isPollEnabled = true
        }
    }

    private func removePoll() {
        withAnimation(.easeInOut(duration: 0.2)) {
            isPollEnabled = false
        }
        pollOptions = [HomePollDraftOption(), HomePollDraftOption()]
    }

    private func removeMedia(_ item: Media) {
        withAnimation(.easeInOut(duration: 0.2)) {
            media.removeAll { $0.id == item.id }
        }
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        isLoadingPhotos = true
        Task {
            var loaded: [Media] = []
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    loaded.append(Media.localPhoto(data, aspectRatio: homeAspectRatio(of: data)))
                }
            }
            let room = max(0, 10 - media.count)
            withAnimation(.easeInOut(duration: 0.2)) {
                media.append(contentsOf: loaded.prefix(room))
            }
            isLoadingPhotos = false
            photoSelection = []
            if loaded.count > room {
                store.showToast("You can add up to 10 photos", symbol: "photo.on.rectangle.angled")
            } else if loaded.count < items.count {
                store.showToast("Some photos couldn't be loaded", symbol: "exclamationmark.triangle.fill")
            }
        }
    }

    // MARK: Submit and dismiss

    private func submit() {
        guard canSubmit else { return }
        isEditorFocused = false
        if let post = request.editingPost {
            store.updatePost(post, text: trimmedText, audience: audience)
            store.homeApplyEdits(
                to: post,
                feeling: feeling,
                location: location,
                taggedUsers: taggedUsers,
                backgroundIndex: effectiveBackgroundIndex
            )
        } else {
            let shared = request.sharedPost.map { $0.sharedPost ?? $0 }
            store.createPost(
                text: trimmedText,
                media: media,
                audience: audience,
                feeling: feeling,
                location: location,
                taggedUsers: taggedUsers,
                backgroundIndex: effectiveBackgroundIndex,
                poll: draftPoll,
                group: request.group,
                timelineOwner: request.timelineOwner,
                sharedPost: shared
            )
            if let shared {
                store.homeCountShare(of: shared)
            }
            if HomeComposerDraft.applies(to: request) {
                HomeComposerDraft.clear()
            }
        }
        Haptics.success()
        dismiss()
    }

    private func attemptDismiss() {
        if isDirty {
            isEditorFocused = false
            showsDiscardDialog = true
        } else {
            dismiss()
        }
    }

    private func saveDraft() {
        if HomeComposerDraft.applies(to: request) {
            HomeComposerDraft.save(text)
        }
        store.showToast("Draft saved", symbol: "square.and.arrow.down.fill")
        dismiss()
    }

    private func discard() {
        if HomeComposerDraft.applies(to: request) {
            HomeComposerDraft.clear()
        }
        dismiss()
    }
}

// MARK: - Helpers

/// The composer's editable values, compared to tell whether there are unsaved changes.
struct HomeComposerSnapshot: Equatable {
    var text: String
    var audience: Audience
    var feelingID: String?
    var location: String?
    var taggedIDs: [String]
    var backgroundIndex: Int?
}

/// "Save as draft" for plain new posts, kept in UserDefaults and restored next time.
enum HomeComposerDraft {
    static let key = "home.composer.draft"

    static func applies(to request: CreatePostRequest) -> Bool {
        request.editingPost == nil && request.group == nil && request.timelineOwner == nil && request.sharedPost == nil
    }

    static func load() -> String? {
        let text = UserDefaults.standard.string(forKey: key) ?? ""
        return text.isEmpty ? nil : text
    }

    static func save(_ text: String) {
        UserDefaults.standard.set(text, forKey: key)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

/// Width divided by height of picked image data, clamped to what the feed lays out well.
private func homeAspectRatio(of data: Data) -> Double {
    guard let image = UIImage(data: data), image.size.height > 0 else { return 1 }
    let ratio = Double(image.size.width / image.size.height)
    return min(max(ratio, 0.5), 2.0)
}

#Preview {
    CreatePostView(request: CreatePostRequest())
        .previewEnvironment()
}
