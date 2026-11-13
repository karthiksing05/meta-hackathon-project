import SwiftUI

/// "Make a game for the two of us": a Blend for you and one friend. The server picks games you'd
/// both like from what each of you plays (`POST /v1/blend` with the two of you) and writes a spec;
/// Studio makes the game from it. Shown on a friend's profile and right after you add a friend.

/// The profile button. Only for friends (not you, not Pages).
struct PairBlendProfileButton: View {
    let user: User

    @State private var showing = false

    var body: some View {
        if !user.isMe && !user.isPage && user.friendship == .friends {
            Button {
                Haptics.light()
                showing = true
            } label: {
                Label("Make a game for the two of us", systemImage: "sparkles")
            }
            .buttonStyle(.fb(.tinted, height: 40))
            .padding(.top, 8)
            .accessibilityHint("Picks games you and \(user.firstName) would both like, and makes a new one for you two")
            .sheet(isPresented: $showing) {
                PairBlendSheet(friend: user)
            }
        }
    }
}

/// The Blend for you and `friend`, in its own sheet.
struct PairBlendSheet: View {
    let friend: User

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PairBlendView(friend: friend, close: { dismiss() })
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

/// Games picked for you and `friend`, and the button that opens Studio with the Blend's spec.
/// `close` dismisses whatever sheet holds it before Studio opens.
struct PairBlendView: View {
    let friend: User
    var close: () -> Void

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @State private var blend: RemoteBlend?
    @State private var failure: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let blend {
                    content(blend)
                } else if let failure {
                    LiveDataStateView(kind: .failed(failure), title: "Couldn't make your Blend", retry: { Task { await load() } })
                } else {
                    LiveDataStateView(kind: .loading, title: "Blending what you both play")
                }
            }
            .padding(.vertical, 12)
        }
        .background(FBColor.surface)
        .navigationTitle("You and \(friend.firstName)")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: friend.id) { await load() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            HStack(spacing: -10) {
                AvatarView(user: appStore.me, size: FBAvatarSize.compact)
                AvatarView(user: friend, size: FBAvatarSize.compact)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("A game for the two of you")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                Text("Picked from what you and \(friend.firstName) play")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
    }

    private func load() async {
        blend = nil
        failure = nil
        guard let myID = GamesAccount.shared.userID else {
            failure = "Sign in to make a Blend."
            return
        }
        do {
            let made = try await GamesAPIFactory.current.pairBlend(
                myID: myID, myName: appStore.me.firstName,
                friendID: friend.id, friendName: friend.firstName, count: 6)
            for game in made.picks.compactMap(\.game) {
                await bubbleStore.adopt(game)
            }
            blend = made
        } catch {
            failure = error.localizedDescription
        }
    }

    @ViewBuilder
    private func content(_ blend: RemoteBlend) -> some View {
        if let spec = blend.spec {
            makeButton(spec)
        }
        if !blend.picks.isEmpty {
            SectionHeader(title: "Play these together", subtitle: "Games you'd both like")
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(blend.picks) { pick in
                        pickCard(pick)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        if blend.spec == nil && blend.picks.isEmpty {
            LiveDataStateView(kind: .empty("Play a few games first, then try again."), title: "Nothing to blend yet")
        }
    }

    /// Studio with the Blend's spec: its prompt is the request, and the spec rides along for the
    /// generate call.
    private func makeButton(_ spec: RemoteBlend.Spec) -> some View {
        Button {
            Haptics.light()
            close()
            router.openStudio(StudioLaunch(mode: .create, prompt: spec.prompt, blendSpec: spec))
        } label: {
            HStack(spacing: 12) {
                BubbleOrb(size: 34)
                    .padding(6)
                    .background(BubbleGlow.brandGradient.opacity(0.55), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Make a game for the two of us")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(spec.why ?? "A new game for you and \(friend.firstName)")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(12)
            .background(FBColor.buttonGray.opacity(0.5), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .padding(.horizontal, 16)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Make a game for the two of us. \(spec.why ?? "")")
    }

    @ViewBuilder
    private func pickCard(_ pick: RemoteBlend.Pick) -> some View {
        if let bubble = bubbleStore.bubble(id: pick.gameID) ?? pick.game.flatMap({ bubbleStore.bubble(id: $0.slug ?? $0.id) }) {
            Button {
                close()
                router.play(bubble.id)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    BubbleCard(bubble: bubble, style: .compact)
                        .frame(width: 112)
                    Text(pick.label)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text(pick.why)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .frame(width: 112, alignment: .leading)
            }
            .buttonStyle(.pressable)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(bubble.title). \(pick.label). \(pick.why)")
        }
    }
}
