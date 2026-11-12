import SwiftUI
import UIKit

enum HomeStoryCreatorStage: Equatable {
    case home
    case text
    case photo(HomeStoryPhotoDraft)
}

/// A photo picked for a story. Compared by id so big image data is never diffed.
struct HomeStoryPhotoDraft: Equatable {
    let id = UUID()
    let data: Data

    static func == (lhs: HomeStoryPhotoDraft, rhs: HomeStoryPhotoDraft) -> Bool {
        lhs.id == rhs.id
    }
}

struct HomePlacedSticker: Identifiable {
    let id = UUID()
    let emoji: String
    /// Offset from the center of the canvas.
    var offset: CGSize
}

// MARK: - Text story editor

/// Tap-to-type text on a gradient, with background swatches and a font size slider.
struct HomeTextStoryEditor: View {
    let onCancel: () -> Void
    let onShare: (String, Int) -> Void

    @State private var text = ""
    @State private var backgroundIndex = 2
    @State private var fontSize: Double = 32
    @FocusState private var isFocused: Bool

    init(onCancel: @escaping () -> Void, onShare: @escaping (String, Int) -> Void) {
        self.onCancel = onCancel
        self.onShare = onShare
    }

    private var palette: PostBackground { PostBackground.preset(backgroundIndex) }

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ZStack {
            palette.gradient
                .ignoresSafeArea()
                .onTapGesture {
                    isFocused = true
                }
            editor
            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                bottomControls
            }
        }
        .animation(.easeInOut(duration: 0.2), value: backgroundIndex)
        .task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            isFocused = true
        }
    }

    private var editor: some View {
        ZStack {
            if text.isEmpty {
                Text("Start typing")
                    .font(.system(size: CGFloat(fontSize), weight: .bold))
                    .foregroundStyle(palette.textColor.opacity(0.6))
                    .allowsHitTesting(false)
            }
            TextField("", text: $text, axis: .vertical)
                .font(.system(size: CGFloat(fontSize), weight: .bold))
                .foregroundStyle(palette.textColor)
                .tint(palette.textColor)
                .multilineTextAlignment(.center)
                .lineLimit(1...10)
                .focused($isFocused)
        }
        .padding(.horizontal, 28)
    }

    private var topBar: some View {
        HStack {
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(palette.textColor)
                    .frame(width: 38, height: 38)
                    .background(Color.black.opacity(0.18), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Discard")
            Spacer()
            if isFocused {
                Button("Done") {
                    isFocused = false
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(palette.textColor)
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(Color.black.opacity(0.18), in: Capsule())
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 52)
    }

    private var bottomControls: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                Text("A")
                    .font(.system(size: 13, weight: .bold))
                Slider(value: $fontSize, in: 20...48)
                    .tint(palette.textColor)
                    .accessibilityLabel("Text size")
                Text("A")
                    .font(.system(size: 22, weight: .bold))
            }
            .foregroundStyle(palette.textColor)
            .padding(.horizontal, 24)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(PostBackground.presets) { preset in
                        Button {
                            Haptics.selection()
                            backgroundIndex = preset.id
                        } label: {
                            Circle()
                                .fill(preset.gradient)
                                .frame(width: 32, height: 32)
                                .overlay {
                                    Circle().stroke(Color.white, lineWidth: preset.id == backgroundIndex ? 3 : 1.5)
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Background \(preset.id + 1)")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }

            Button {
                onShare(trimmed, backgroundIndex)
            } label: {
                Text("Share to story")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(FBColor.brandBlue, in: Capsule())
            }
            .buttonStyle(.pressable)
            .disabled(trimmed.isEmpty)
            .opacity(trimmed.isEmpty ? 0.5 : 1)
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 12)
    }
}

// MARK: - Photo story editor

/// Preview of a picked photo with a caption, a movable text overlay and emoji stickers.
struct HomePhotoStoryEditor: View {
    let draft: HomeStoryPhotoDraft
    let onCancel: () -> Void
    let onShare: (Data, String) -> Void

    @Environment(\.displayScale) private var displayScale
    @Environment(AppStore.self) private var store

    @State private var caption = ""
    @State private var overlayText = ""
    @State private var textOffset: CGSize = .zero
    @State private var isEditingText = false
    @State private var stickers: [HomePlacedSticker] = []
    @State private var showsStickerPicker = false
    @State private var canvasSize: CGSize = .zero
    @FocusState private var isOverlayFieldFocused: Bool

    init(draft: HomeStoryPhotoDraft, onCancel: @escaping () -> Void, onShare: @escaping (Data, String) -> Void) {
        self.draft = draft
        self.onCancel = onCancel
        self.onShare = onShare
    }

    private var hasOverlayText: Bool {
        !overlayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
            VStack(spacing: 8) {
                canvas
                Color.clear
                    .frame(height: 58)
            }
            .ignoresSafeArea(.keyboard)

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                captionBar
            }

            if isEditingText {
                textEditorOverlay
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: isEditingText)
        .sheet(isPresented: $showsStickerPicker) {
            HomeStickerPicker { emoji in
                addSticker(emoji)
            }
        }
    }

    // MARK: Canvas

    private var canvas: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black
                RemoteImage(url: nil, data: draft.data, contentMode: .fill, placeholder: .clear)
                    .blur(radius: 30)
                    .opacity(0.6)
                RemoteImage(url: nil, data: draft.data, contentMode: .fit, placeholder: .clear)
                ForEach($stickers) { $sticker in
                    HomeDraggableSticker(sticker: $sticker)
                }
                if hasOverlayText && !isEditingText {
                    HomeDraggableOverlayText(text: overlayText, offset: $textOffset) {
                        beginTextEditing()
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
            .onAppear {
                canvasSize = proxy.size
            }
            .onChange(of: proxy.size) { _, newSize in
                canvasSize = newSize
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 4)
    }

    // MARK: Chrome

    private var topBar: some View {
        HStack(alignment: .top) {
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(Color.black.opacity(0.4), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Discard")
            Spacer()
            VStack(spacing: 14) {
                toolButton(title: "Text", symbol: "textformat") {
                    beginTextEditing()
                }
                toolButton(title: "Stickers", symbol: "face.smiling") {
                    showsStickerPicker = true
                }
                toolButton(title: "Music", symbol: "music.note") {
                    store.showToast("Music isn't available in this demo", symbol: "music.note")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
    }

    private func toolButton(title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(Color.black.opacity(0.4), in: Circle())
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .shadow(color: Color.black.opacity(0.5), radius: 2)
            }
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(title)
    }

    private var captionBar: some View {
        HStack(spacing: 10) {
            TextField("Add a caption...", text: $caption)
                .font(.system(size: 15))
                .foregroundStyle(.white)
                .tint(.white)
                .submitLabel(.done)
                .padding(.horizontal, 14)
                .frame(height: 42)
                .background(Color.white.opacity(0.14), in: Capsule())
            Button {
                share()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus.circle.fill")
                    Text("Share to story")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 42)
                .background(FBColor.brandBlue, in: Capsule())
            }
            .buttonStyle(.pressable)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var textEditorOverlay: some View {
        ZStack {
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .onTapGesture {
                    endTextEditing()
                }
            ZStack {
                if overlayText.isEmpty {
                    Text("Type something")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .allowsHitTesting(false)
                }
                TextField("", text: $overlayText, axis: .vertical)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
                    .tint(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(1...6)
                    .focused($isOverlayFieldFocused)
            }
            .padding(.horizontal, 32)
            VStack {
                HStack {
                    Spacer()
                    Button("Done") {
                        endTextEditing()
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(16)
                }
                Spacer()
            }
        }
    }

    // MARK: Actions

    private func beginTextEditing() {
        isEditingText = true
        Task {
            try? await Task.sleep(nanoseconds: 150_000_000)
            isOverlayFieldFocused = true
        }
    }

    private func endTextEditing() {
        isOverlayFieldFocused = false
        isEditingText = false
    }

    private func addSticker(_ emoji: String) {
        Haptics.light()
        let offset = CGSize(width: CGFloat.random(in: -70...70), height: CGFloat.random(in: -140...140))
        stickers.append(HomePlacedSticker(emoji: emoji, offset: offset))
    }

    private func share() {
        let data: Data
        if hasOverlayText || !stickers.isEmpty {
            data = renderComposite() ?? draft.data
        } else {
            data = draft.data
        }
        onShare(data, caption)
    }

    /// Flattens the photo, text and stickers into one image, laid out exactly like the canvas.
    @MainActor
    private func renderComposite() -> Data? {
        guard canvasSize.width > 1, canvasSize.height > 1, let image = UIImage(data: draft.data) else { return nil }
        let content = HomeStoryRenderCanvas(
            image: image,
            overlayText: hasOverlayText ? overlayText : "",
            textOffset: textOffset,
            stickers: stickers
        )
        .frame(width: canvasSize.width, height: canvasSize.height)
        let renderer = ImageRenderer(content: content)
        renderer.scale = displayScale
        return renderer.uiImage?.jpegData(compressionQuality: 0.88)
    }
}

// MARK: - Overlays

/// The text overlay's look, shared by the editor and the renderer.
struct HomeStoryOverlayLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 28, weight: .bold))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, 24)
    }
}

struct HomeStickerLabel: View {
    let emoji: String

    var body: some View {
        Text(emoji)
            .font(.system(size: 64))
            .shadow(color: Color.black.opacity(0.25), radius: 4, y: 2)
    }
}

private struct HomeDraggableSticker: View {
    @Binding var sticker: HomePlacedSticker
    @State private var dragStart: CGSize? = nil

    init(sticker: Binding<HomePlacedSticker>) {
        _sticker = sticker
    }

    var body: some View {
        HomeStickerLabel(emoji: sticker.emoji)
            .offset(sticker.offset)
            .gesture(
                DragGesture(coordinateSpace: .global)
                    .onChanged { value in
                        let start = dragStart ?? sticker.offset
                        if dragStart == nil {
                            dragStart = start
                        }
                        sticker.offset = CGSize(
                            width: start.width + value.translation.width,
                            height: start.height + value.translation.height
                        )
                    }
                    .onEnded { _ in
                        dragStart = nil
                    }
            )
            .accessibilityLabel("Sticker \(sticker.emoji)")
    }
}

private struct HomeDraggableOverlayText: View {
    let text: String
    @Binding var offset: CGSize
    let onTap: () -> Void

    @State private var dragStart: CGSize? = nil

    init(text: String, offset: Binding<CGSize>, onTap: @escaping () -> Void) {
        self.text = text
        _offset = offset
        self.onTap = onTap
    }

    var body: some View {
        HomeStoryOverlayLabel(text: text)
            .offset(offset)
            .onTapGesture {
                onTap()
            }
            .gesture(
                DragGesture(coordinateSpace: .global)
                    .onChanged { value in
                        let start = dragStart ?? offset
                        if dragStart == nil {
                            dragStart = start
                        }
                        offset = CGSize(
                            width: start.width + value.translation.width,
                            height: start.height + value.translation.height
                        )
                    }
                    .onEnded { _ in
                        dragStart = nil
                    }
            )
    }
}

/// The same layout as the editor canvas, drawn from a decoded image so `ImageRenderer`
/// can capture it synchronously.
private struct HomeStoryRenderCanvas: View {
    let image: UIImage
    let overlayText: String
    let textOffset: CGSize
    let stickers: [HomePlacedSticker]

    var body: some View {
        ZStack {
            Color.black
            Color.clear
                .overlay {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                }
                .clipped()
                .blur(radius: 30)
                .opacity(0.6)
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
            ForEach(stickers) { sticker in
                HomeStickerLabel(emoji: sticker.emoji)
                    .offset(sticker.offset)
            }
            if !overlayText.isEmpty {
                HomeStoryOverlayLabel(text: overlayText)
                    .offset(textOffset)
            }
        }
        .clipped()
    }
}

// MARK: - Sticker picker

struct HomeStickerPicker: View {
    let onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    private let emojis = [
        "😀", "😂", "🥰", "😍", "😎", "🤩", "🥳", "😇", "🤗", "🙌", "👏", "👍",
        "❤️", "🔥", "✨", "🎉", "🌈", "☀️", "🌙", "⭐️", "🌸", "🌴", "🍕", "🍔",
        "🍦", "☕️", "🍹", "🎂", "🎁", "🎈", "⚽️", "🏀", "🎮", "🎧", "📸", "✈️",
        "🚗", "🏖️", "🐶", "🐱", "🦄", "💯", "💪", "🙏", "👀", "💬",
    ]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 6)

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(emojis, id: \.self) { emoji in
                        Button {
                            onPick(emoji)
                            dismiss()
                        } label: {
                            Text(emoji)
                                .font(.system(size: 38))
                                .frame(maxWidth: .infinity, minHeight: 52)
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Stickers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
