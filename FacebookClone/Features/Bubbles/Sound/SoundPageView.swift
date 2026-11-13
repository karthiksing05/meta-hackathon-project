import SwiftUI

/// A library sound's page, like a TikTok sound page: cover, title, creator, how many games use it,
/// a big play button, Save, "Use this sound" (opens Studio with it attached), and a 3-column grid of
/// the games using it (Top or Recent). The sound plays in the background while the page is open.
/// Everything comes from `/v1/sounds/{id}` and `/v1/sounds/{id}/games`.
struct SoundPageView: View {
    let soundID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(AppStore.self) private var appStore

    enum Sort: String, CaseIterable, Identifiable {
        case top, recent
        var id: String { rawValue }
        var title: String { self == .top ? "Top" : "Recent" }
    }

    @State private var sound: RemoteSound?
    @State private var games: [RemoteGame] = []
    @State private var total = 0
    @State private var sort: Sort = .top
    @State private var state: FeedLoadState = .loading
    @State private var gamesState: FeedLoadState = .loading
    @State private var isSaving = false

    private var player: LibrarySoundPlayer { LibrarySoundPlayer.shared }

    var body: some View {
        Group {
            if let sound {
                content(sound)
            } else if case .failed(let message) = state {
                LiveDataStateView(kind: .failed(message), title: "Couldn't load this sound") { Task { await load() } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                LiveDataStateView(kind: .loading, title: "Loading the sound…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(FBColor.background)
        .navigationTitle("Sound")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onDisappear { player.stop(.page) }
    }

    // MARK: Layout

    private func content(_ sound: RemoteSound) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FBSpacing.l) {
                header(sound)
                actions(sound)
                Picker("Sort", selection: $sort) {
                    ForEach(Sort.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, FBMetrics.screenPadding)
                grid
            }
            .padding(.top, FBSpacing.m)
            .padding(.bottom, FBSpacing.xl)
        }
        .refreshable { await load() }
        .onChange(of: sort) { Task { await loadGames() } }
    }

    private func header(_ sound: RemoteSound) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Button {
                Haptics.light()
                togglePlay(sound)
            } label: {
                SoundCoverArt(url: sound.coverURL, seed: sound.id)
                    .frame(width: 104, height: 104)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .overlay {
                        Image(systemName: isPlaying(sound) ? "pause.fill" : "play.fill")
                            .font(.system(size: 26, weight: .bold))
                            .foregroundStyle(Color.white)
                            .shadow(color: .black.opacity(0.4), radius: 3)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isPlaying(sound) ? "Pause the sound" : "Play the sound")

            VStack(alignment: .leading, spacing: 4) {
                Text(sound.title)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                if !sound.creator.isEmpty {
                    Text(sound.creator)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
                Text(countLine(sound))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                if sound.kind == "original" {
                    Text("Original sound")
                        .font(.fbMicroEmphasized)
                        .foregroundStyle(FBColor.accent)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FBMetrics.screenPadding)
    }

    private func actions(_ sound: RemoteSound) -> some View {
        HStack(spacing: 10) {
            Button {
                Haptics.light()
                player.stop(.page)
                router.openStudio(StudioLaunch(prompt: "", sound: sound.asGameSound))
            } label: {
                Label("Use this sound", systemImage: "music.note.list")
            }
            .buttonStyle(.fb(.primary, height: 40))

            Button {
                Task { await toggleSave(sound) }
            } label: {
                Label(sound.savedByMe ? "Saved" : "Save", systemImage: sound.savedByMe ? "bookmark.fill" : "bookmark")
            }
            .buttonStyle(.fb(.secondary, expand: false, height: 40))
            .disabled(isSaving)
        }
        .padding(.horizontal, FBMetrics.screenPadding)
    }

    @ViewBuilder
    private var grid: some View {
        if games.isEmpty {
            switch gamesState {
            case .loading:
                LiveDataStateView(kind: .loading, title: "Loading games…")
                    .frame(maxWidth: .infinity)
                    .padding(.top, FBSpacing.xl)
            case .failed(let message):
                LiveDataStateView(kind: .failed(message), title: "Couldn't load the games") { Task { await loadGames() } }
                    .frame(maxWidth: .infinity)
            default:
                LiveDataStateView(kind: .empty("No games use this sound yet. Be the first: tap Use this sound."))
                    .frame(maxWidth: .infinity)
                    .padding(.top, FBSpacing.l)
            }
        } else {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
                ForEach(games) { game in
                    Button { open(game) } label: { SoundGameTile(game: game) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private func countLine(_ sound: RemoteSound) -> String {
        let n = max(total, sound.useCount)
        let games = n == 1 ? "1 game" : "\(n.fbCompact) games"
        let saves = sound.saves == 1 ? "1 save" : "\(sound.saves.fbCompact) saves"
        return sound.saves > 0 ? "\(games) · \(saves)" : games
    }

    // MARK: Actions

    private func isPlaying(_ sound: RemoteSound) -> Bool {
        player.current?.id == sound.id && player.isPlaying
    }

    private func togglePlay(_ sound: RemoteSound) {
        if player.current?.id == sound.id {
            if GameSound.isMuted { GameSound.isMuted = false } else { player.togglePause() }
        } else {
            player.play(sound.asGameSound, for: .page)
        }
    }

    private func load() async {
        if sound == nil { state = .loading }
        do {
            let fetched = try await GamesAPIFactory.current.sound(id: soundID)
            sound = fetched
            state = .idle
            if player.current?.id != fetched.id { player.play(fetched.asGameSound, for: .page) }
        } catch {
            state = .failed(error.localizedDescription)
        }
        await loadGames()
    }

    private func loadGames() async {
        gamesState = .loading
        do {
            let page = try await GamesAPIFactory.current.soundGames(id: soundID, sort: sort.rawValue)
            games = page.items
            total = page.total
            gamesState = .idle
        } catch {
            gamesState = .failed(error.localizedDescription)
        }
    }

    private func toggleSave(_ sound: RemoteSound) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await GamesAPIFactory.current.setSoundSaved(!sound.savedByMe, soundID: sound.id)
            self.sound?.savedByMe = saved.savedByMe
            self.sound?.saves = saved.saves
            Haptics.light()
        } catch {
            appStore.showToast("Couldn't save: \(error.localizedDescription)", symbol: "exclamationmark.circle")
        }
    }

    private func open(_ game: RemoteGame) {
        Task { @MainActor in
            if let bubble = await bubbleStore.adopt(game) {
                router.play(bubble.id)
            } else {
                appStore.showToast("Couldn't open that game", symbol: "exclamationmark.circle")
            }
        }
    }
}

/// One game in a sound's grid: its cover (or a gradient), title and plays.
private struct SoundGameTile: View {
    let game: RemoteGame

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            SoundCoverArt(url: game.coverURL, seed: game.id)
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 1) {
                Text(game.title)
                    .font(.fbMicroEmphasized)
                    .lineLimit(2)
                Label(game.plays.fbCompact, systemImage: "play.fill")
                    .font(.fbMicro)
                    .labelStyle(.titleAndIcon)
            }
            .foregroundStyle(Color.white)
            .padding(6)
        }
        .aspectRatio(3 / 4, contentMode: .fit)
        .clipped()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(game.title), \(game.plays) plays")
        .accessibilityAddTraits(.isButton)
    }
}
