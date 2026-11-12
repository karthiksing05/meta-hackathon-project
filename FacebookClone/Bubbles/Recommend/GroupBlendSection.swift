import SwiftUI

/// "<Group> Blend" on a Group page: games picked for everyone here, a Blend game Muse makes for
/// all of you, and people with a taste like yours to add as friends (`BubbleStore.groupBlend`).
/// Shows nothing when the recommender is off or the Group is too small.
struct GroupBlendSection: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @State private var blend: GroupBlend?
    @State private var loadedGroupID: String?

    var body: some View {
        VStack(spacing: 0) {
            if let blend, !blend.picks.isEmpty {
                content(blend)
            }
        }
        .onAppear(perform: load)
    }

    private func load() {
        guard loadedGroupID != group.id else { return }
        loadedGroupID = group.id
        blend = bubbleStore.groupBlend(for: group)
    }

    private func content(_ blend: GroupBlend) -> some View {
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
    private func pickCard(_ pick: GroupBlend.Pick) -> some View {
        if let bubble = bubbleStore.bubble(id: pick.gameID) {
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
    private func blendGameRow(_ spec: GroupBlend.Spec) -> some View {
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
                    Text(spec.why)
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
        .accessibilityLabel("Make our Blend game. \(spec.why)")
    }

    /// Someone here with a taste like yours, with Add friend.
    private func twinRow(_ twin: GroupBlend.Twin) -> some View {
        let user = bubbleStore.resolvePerson(twin.userID)
        return HStack(spacing: 10) {
            AvatarView(user: user, size: FBAvatarSize.reply)
            VStack(alignment: .leading, spacing: 2) {
                Text("Taste twin: \(twin.name)")
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(twin.why + (twin.evenlyMatched == true ? ", and you're evenly matched" : ""))
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
                withAnimation { appStore.sendRequest(to: user) }
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 32))
            .accessibilityLabel("Add \(user.name) as a friend")
        }
    }
}
