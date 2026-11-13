import SwiftUI

/// Studio's sound row: the sound the game will play behind it ("Use this sound", or picked here),
/// or "Add sound", which opens the library.
struct StudioSoundRow: View {
    @Bindable var model: StudioModel
    @State private var showsPicker = false

    var body: some View {
        Group {
            if let sound = model.sound {
                HStack(spacing: 10) {
                    SoundDisc(sound: sound, size: 34, isSpinning: false)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(sound.title)
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text(sound.creator.isEmpty ? "Plays behind your game" : "\(sound.creator) · plays behind your game")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Button("Change") { showsPicker = true }
                        .font(.fbMetaEmphasized)
                    Button {
                        Haptics.light()
                        model.sound = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove the sound")
                }
                .padding(10)
                .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            } else {
                Button {
                    showsPicker = true
                } label: {
                    Label("Add sound", systemImage: "music.note")
                        .font(.fbMetaEmphasized)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(FBColor.inputBackground, in: Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(FBColor.primaryText)
            }
        }
        .sheet(isPresented: $showsPicker) {
            SoundPickerSheet { picked in model.sound = picked }
                .presentationDetents([.medium, .large])
        }
    }
}

/// The library, to pick a sound: For you, Trending, Saved and search, with a preview on each row.
/// Shows "No sounds yet" until the server's library has some (no sample sounds in the app).
struct SoundPickerSheet: View {
    let onPick: (RemoteGameSound) -> Void

    @Environment(\.dismiss) private var dismiss

    enum Tab: String, CaseIterable, Identifiable {
        case forYou = "for_you", trending, saved
        var id: String { rawValue }
        var title: String {
            switch self {
            case .forYou: return "For you"
            case .trending: return "Trending"
            case .saved: return "Saved"
            }
        }
    }

    @State private var tab: Tab = .forYou
    @State private var query = ""
    @State private var sounds: [RemoteSound] = []
    @State private var state: FeedLoadState = .loading

    private var player: LibrarySoundPlayer { LibrarySoundPlayer.shared }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Tab", selection: $tab) {
                        ForEach(Tab.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if sounds.isEmpty {
                    Section { emptyState }
                } else {
                    Section {
                        ForEach(sounds) { row($0) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $query, prompt: "Search sounds")
            .navigationTitle("Add sound")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task(id: "\(tab.rawValue)|\(query)") {
                if !query.isEmpty { try? await Task.sleep(nanoseconds: 300_000_000) }
                guard !Task.isCancelled else { return }
                await load()
            }
            .onDisappear { player.stop(.picker) }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        switch state {
        case .loading:
            LiveDataStateView(kind: .loading, title: "Loading sounds…")
        case .failed(let message):
            LiveDataStateView(kind: .failed(message), title: "Couldn't load sounds") { Task { await load() } }
        default:
            LiveDataStateView(kind: .empty(emptyText))
        }
    }

    private var emptyText: String {
        if !query.isEmpty { return "No sounds match “\(query)”." }
        return tab == .saved ? "Sounds you save show up here." : "No sounds yet. The library is on its way."
    }

    private func row(_ sound: RemoteSound) -> some View {
        let previewing = player.current?.id == sound.id && player.isPlaying
        return HStack(spacing: 12) {
            Button {
                if previewing { player.stop(.picker) } else { player.play(sound.asGameSound, for: .picker) }
            } label: {
                SoundCoverArt(url: sound.coverURL, seed: sound.id)
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                    .overlay {
                        Image(systemName: previewing ? "pause.fill" : "play.fill")
                            .foregroundStyle(Color.white)
                            .shadow(radius: 2)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(previewing ? "Stop preview" : "Preview \(sound.title)")
            VStack(alignment: .leading, spacing: 2) {
                Text(sound.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text([sound.creator, sound.useCount > 0 ? "\(sound.useCount.fbCompact) games" : nil]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Button("Use") {
                Haptics.light()
                onPick(sound.asGameSound)
                dismiss()
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        state = .loading
        do {
            sounds = try await GamesAPIFactory.current.sounds(tab: tab.rawValue, query: query)
            state = .idle
        } catch GamesAPIError.notFound {
            // The server doesn't have sounds yet.
            sounds = []
            state = .idle
        } catch {
            sounds = []
            state = .failed(error.localizedDescription)
        }
    }
}
