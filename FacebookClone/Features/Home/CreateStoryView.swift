import PhotosUI
import SwiftUI

/// The story creator (full-screen cover): creation tiles on top, the camera roll below,
/// then a text editor or a photo editor that shares to your story.
struct CreateStoryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store

    @State private var stage: HomeStoryCreatorStage = .home
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isLoadingPhoto = false

    var body: some View {
        ZStack {
            Color(hex: 0x18191A)
                .ignoresSafeArea()
            stageView
        }
        .animation(.easeInOut(duration: 0.25), value: stage)
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 24)
        }
    }

    @ViewBuilder
    private var stageView: some View {
        switch stage {
        case .home:
            home
                .transition(.opacity)
        case .text:
            HomeTextStoryEditor(
                onCancel: { stage = .home },
                onShare: { text, index in shareText(text, backgroundIndex: index) }
            )
            .transition(.move(edge: .bottom))
        case .photo(let draft):
            HomePhotoStoryEditor(
                draft: draft,
                onCancel: { stage = .home },
                onShare: { data, caption in sharePhoto(data, caption: caption) }
            )
            .transition(.move(edge: .trailing))
        }
    }

    // MARK: Home stage

    private var home: some View {
        VStack(spacing: 0) {
            topBar
            optionsRow
            cameraRollHeader
            cameraRoll
        }
    }

    private var topBar: some View {
        ZStack {
            Text("Create story")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
                Spacer()
                Button {
                    store.showToast("Story settings aren't available in this demo", symbol: "gearshape.fill")
                } label: {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Story settings")
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 52)
    }

    private var optionsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(HomeStoryCreateOption.allCases) { option in
                    Button {
                        select(option)
                    } label: {
                        HomeStoryOptionTile(option: option)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel(option.title)
                }
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 8)
    }

    private var cameraRollHeader: some View {
        HStack(spacing: 6) {
            Text("Camera roll")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)
            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
            Spacer()
            if isLoadingPhoto {
                ProgressView()
                    .tint(.white)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var cameraRoll: some View {
        PhotosPicker(
            selection: $pickerItems,
            maxSelectionCount: 1,
            selectionBehavior: .continuous,
            matching: .images
        ) {
            Label("Choose from camera roll", systemImage: "photo.on.rectangle.angled")
        }
        .photosPickerStyle(.inline)
        .photosPickerDisabledCapabilities(.selectionActions)
        .photosPickerAccessoryVisibility(.hidden, edges: .all)
        .environment(\.colorScheme, .dark)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .disabled(isLoadingPhoto)
        .onChange(of: pickerItems) { _, items in
            guard let item = items.first else { return }
            loadPhoto(item)
        }
    }

    // MARK: Actions

    private func select(_ option: HomeStoryCreateOption) {
        Haptics.light()
        switch option {
        case .text:
            stage = .text
        case .music, .boomerang, .selfie, .aiImages:
            store.showToast("Not available in this demo", symbol: option.symbol)
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem) {
        isLoadingPhoto = true
        Task {
            let data = try? await item.loadTransferable(type: Data.self)
            isLoadingPhoto = false
            pickerItems = []
            guard let data else {
                store.showToast("Couldn't load that photo", symbol: "exclamationmark.triangle.fill")
                return
            }
            stage = .photo(HomeStoryPhotoDraft(data: data))
        }
    }

    private func shareText(_ text: String, backgroundIndex: Int) {
        store.addStory(.text(text, backgroundIndex: backgroundIndex))
        Haptics.success()
        dismiss()
    }

    private func sharePhoto(_ data: Data, caption: String) {
        let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        store.addStory(.localPhoto(data), caption: trimmed.isEmpty ? nil : trimmed)
        Haptics.success()
        dismiss()
    }
}

// MARK: - Creation tiles

enum HomeStoryCreateOption: String, CaseIterable, Identifiable {
    case text
    case music
    case boomerang
    case selfie
    case aiImages

    var id: String { rawValue }

    var title: String {
        switch self {
        case .text: return "Text"
        case .music: return "Music"
        case .boomerang: return "Boomerang"
        case .selfie: return "Selfie"
        case .aiImages: return "AI images"
        }
    }

    var symbol: String {
        switch self {
        case .text: return "textformat"
        case .music: return "music.note"
        case .boomerang: return "infinity"
        case .selfie: return "camera.fill"
        case .aiImages: return "sparkles"
        }
    }

    var colors: [Color] {
        switch self {
        case .text: return [Color(hex: 0x0866FF), Color(hex: 0x00C6FF)]
        case .music: return [Color(hex: 0xC600FF), Color(hex: 0xF5576C)]
        case .boomerang: return [Color(hex: 0xFF8008), Color(hex: 0xFFC837)]
        case .selfie: return [Color(hex: 0x11998E), Color(hex: 0x38EF7D)]
        case .aiImages: return [Color(hex: 0x4E54C8), Color(hex: 0xE42D6F)]
        }
    }
}

private struct HomeStoryOptionTile: View {
    let option: HomeStoryCreateOption

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            Circle()
                .fill(Color.white)
                .frame(width: 40, height: 40)
                .overlay {
                    icon
                }
            Spacer(minLength: 0)
            Text(option.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.bottom, 12)
        }
        .frame(width: 100, height: 150)
        .background(
            LinearGradient(colors: option.colors, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
    }

    @ViewBuilder
    private var icon: some View {
        let tint = option.colors.first ?? FBColor.brandBlue
        if option == .text {
            Text("Aa")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(tint)
        } else {
            Image(systemName: option.symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
        }
    }
}

#Preview {
    CreateStoryView()
        .previewEnvironment()
}
