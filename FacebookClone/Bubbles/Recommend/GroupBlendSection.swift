import SwiftUI

/// "<Group> Blend" on a Group page: games picked for everyone here, a Blend game Muse makes for
/// all of you, and people with a taste like yours to add as friends. The server makes it from what
/// the members actually play (`POST /v1/groups/{id}/blend`); only members can ask. Shows nothing
/// for Groups the server doesn't know, and a short line when the Blend can't be made.
struct GroupBlendSection: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @State private var blend: RemoteBlend?
    @State private var failure: String?

    var body: some View {
        VStack(spacing: 0) {
            if let blend, !blend.picks.isEmpty {
                content(blend)
            } else if let failure {
                Text("\(group.name) Blend isn't available: \(failure)")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: group.id) { await load() }
    }

    /// Only Groups on the games server have a Blend, and only their members can ask for it.
    private func load() async {
        blend = nil
        failure = nil
        guard bubbleStore.serverGroups[group.id] != nil, group.isMember else { return }
        do {
            let made = try await GamesAPIFactory.current.blend(groupID: group.id, count: 8)
            for game in made.picks.compactMap(\.game) {
                await bubbleStore.adopt(game)
            }
            blend = made
        } catch {
            failure = error.localizedDescription
        }
    }

    private func content(_ blend: RemoteBlend) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "\(group.name) Blend", subtitle: "Games picked for everyone here")
                .padding(.horizontal, 16)
                .padding(.top, 12)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(blend.picks) { pick in
                        pickCard(pick)
                    }
                }
                .padding(.horizontal, 16)
            }
            if let spec = blend.spec, group.isMember {
                blendGameRow(spec)
            }
            ForEach(blend.twins.prefix(2)) { twin in
                twinRow(twin)
            }
        }
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .overlay(alignment: .top) { HairlineDivider() }
    }

    @ViewBuilder
    private func pickCard(_ pick: RemoteBlend.Pick) -> some View {
        if let bubble = bubbleStore.bubble(id: pick.gameID) ?? pick.game.flatMap({ bubbleStore.bubble(id: $0.slug ?? $0.id) }) {
            NavigationLink(value: Route.bubble(bubble.id)) {
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

    /// "Make our Blend game": Muse Studio with the Blend's prompt, made for this Group.
    private func blendGameRow(_ spec: RemoteBlend.Spec) -> some View {
        Button {
            Haptics.light()
            router.openStudio(StudioLaunch(mode: .create, groupID: group.id, prompt: spec.prompt))
        } label: {
            HStack(spacing: 12) {
                BubbleOrb(size: 34)
                    .padding(6)
                    .background(BubbleGlow.brandGradient.opacity(0.55), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Make our Blend game")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(spec.why ?? "A game for everyone here")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Make our Blend game. \(spec.why ?? "")")
    }

    /// Someone here with a taste like yours, with Add friend.
    private func twinRow(_ twin: RemoteBlend.Twin) -> some View {
        let user = bubbleStore.person(id: twin.userID, name: twin.name)
        return HStack(spacing: 10) {
            AvatarView(user: user, size: FBAvatarSize.reply)
            VStack(alignment: .leading, spacing: 2) {
                Text("Taste twin: \(twin.name)")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(twin.why)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            friendButton(user)
        }
        .padding(.horizontal, 16)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func friendButton(_ user: User) -> some View {
        switch user.friendship {
        case .requestSent:
            Text("Requested")
                .font(.fbCaptionEmphasized)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(FBColor.buttonGray, in: Capsule())
        case .friends, .me:
            EmptyView()
        default:
            Button("Add friend") {
                Haptics.light()
                Task { @MainActor in
                    do {
                        try await GamesAPIFactory.current.setFriend(true, userID: user.id)
                        withAnimation { user.friendship = .friends }
                    } catch {
                        appStore.showToast("Couldn't add \(user.firstName): \(error.localizedDescription)", symbol: "exclamationmark.circle")
                    }
                }
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 32))
            .accessibilityLabel("Add \(user.name) as a friend")
        }
    }
}
