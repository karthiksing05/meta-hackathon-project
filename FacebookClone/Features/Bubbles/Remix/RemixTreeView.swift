import SwiftUI

// The remix tree (docs/BUBBLES.md 7.5): the family's original, its remixes and theirs, with
// creators' avatars, friends ringed in blue, and taps to each Bubble's page. Cheap to draw: covers
// are images or gradients, never web views.

/// A small remix tree. `bubble` is the Bubble whose page this is; the tree starts at its family's
/// original and highlights it.
struct RemixTreeView: View {
    let bubble: Bubble
    var maxDepth = 2
    var maxNodes = 6
    /// Called with the tapped Bubble. Nil pushes its page.
    var onOpen: ((Bubble) -> Void)? = nil

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let tree = RemixLineage.tree(around: bubble, in: bubbleStore.bubbles, maxDepth: maxDepth, maxNodes: maxNodes)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(tree.rows) { row in
                RemixTreeRow(row: row, isCurrent: row.bubble.id == bubble.id) {
                    open(row.bubble)
                }
            }
            if tree.hidden > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: FBIconSize.small, weight: .semibold))
                    Text(RemixCopy.more(tree.hidden))
                        .font(.fbMetaEmphasized)
                }
                .foregroundStyle(FBColor.secondaryText)
                .padding(.leading, RemixTreeRow.indent + 8)
                .padding(.vertical, 6)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func open(_ target: Bubble) {
        Haptics.light()
        if let onOpen {
            onOpen(target)
        } else if target.id != bubble.id {
            router.push(.bubble(target.id))
        }
    }
}

/// One node: an indent with an elbow, the cover, the creator's avatar, title and byline.
private struct RemixTreeRow: View {
    let row: RemixLineage.Row
    let isCurrent: Bool
    let action: () -> Void

    static let indent: CGFloat = 22

    @Environment(AppStore.self) private var appStore
    @ScaledMetric(relativeTo: .body) private var thumb: CGFloat = 44

    private var creator: User { row.bubble.creator }
    private var isMe: Bool { creator.id == appStore.me.id }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if row.depth > 0 {
                    RemixTreeElbow(isLast: row.isLastSibling)
                        .frame(width: Self.indent)
                        .padding(.leading, CGFloat(row.depth - 1) * Self.indent)
                        .accessibilityHidden(true)
                }
                cover
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(row.bubble.title)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        if row.depth == 0 {
                            RemixTreeBadge(text: RemixCopy.original, symbol: "star.fill")
                        }
                    }
                    HStack(spacing: 4) {
                        Text(isMe ? RemixCopy.you : RemixCopy.byLine(creator.firstName))
                            .lineLimit(1)
                        if creator.isFriend {
                            Text("·")
                            Text(RemixCopy.friend)
                                .foregroundStyle(FBColor.accent)
                        }
                        if row.hiddenChildren > 0 {
                            Text("·")
                            Text(RemixCopy.remixCount(row.hiddenChildren))
                        }
                    }
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 4)
                if isCurrent {
                    RemixTreeBadge(text: RemixCopy.thisOne, symbol: "mappin")
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.small, weight: .semibold))
                        .foregroundStyle(FBColor.tertiaryText)
                }
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 8)
            .background {
                if isCurrent {
                    RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                        .fill(FBColor.tintedBlueBackground)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(isCurrent ? "" : RemixCopy.a11yOpens)
    }

    private var cover: some View {
        BubbleCoverView(bubble: row.bubble, showsEmoji: true)
            .frame(width: thumb, height: thumb)
            .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            .overlay(alignment: .bottomTrailing) {
                RemixAvatar(user: creator, size: FBAvatarSize.tiny, highlighted: creator.isFriend)
                    .offset(x: 6, y: 6)
            }
            .padding(.trailing, 4)
            .padding(.bottom, 4)
    }

    private var accessibilityText: String {
        var parts = [row.bubble.title, isMe ? RemixCopy.a11yMadeByYou : RemixCopy.a11yMadeBy(creator.name)]
        if row.depth == 0 { parts.append(RemixCopy.a11yOriginal) }
        if creator.isFriend { parts.append(RemixCopy.a11yFriend) }
        if isCurrent { parts.append(RemixCopy.a11yThisOne) }
        return parts.joined(separator: ", ")
    }
}

/// An avatar with a blue ring for friends.
struct RemixAvatar: View {
    let user: User
    var size: CGFloat = FBAvatarSize.tiny
    var highlighted = false

    var body: some View {
        AvatarView(user: user, size: size)
            .padding(highlighted ? 2 : 1)
            .background(Circle().fill(FBColor.surface))
            .overlay {
                if highlighted {
                    Circle().strokeBorder(FBColor.brandBlue, lineWidth: 2)
                }
            }
    }
}

/// The connector to a node's parent.
private struct RemixTreeElbow: View {
    let isLast: Bool

    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            Path { path in
                let x = w * 0.4
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: isLast ? h / 2 : h))
                path.move(to: CGPoint(x: x, y: h / 2))
                path.addLine(to: CGPoint(x: w, y: h / 2))
            }
            .stroke(FBColor.divider, style: StrokeStyle(lineWidth: 2, lineCap: .round))
        }
    }
}

private struct RemixTreeBadge: View {
    let text: String
    let symbol: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .bold))
            Text(text)
                .font(.fbCaptionEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(FBColor.accent)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(FBColor.tintedBlueBackground, in: Capsule())
    }
}

/// People in a remix family you aren't friends with yet ("Maya remixed this too"), each with a
/// one-tap Add friend. Posts the `addFriendFromGame` signal.
struct RemixPeopleRow: View {
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore

    var body: some View {
        let people = strangers
        if !people.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(RemixCopy.peopleTitle)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
                    .accessibilityAddTraits(.isHeader)
                ForEach(people) { person in
                    HStack(spacing: 10) {
                        AvatarView(user: person, size: FBAvatarSize.comment)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(person.name)
                                .font(.fbName)
                                .foregroundStyle(FBColor.primaryText)
                                .lineLimit(1)
                            Text(RemixCopy.peopleSub(person.firstName))
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                                .lineLimit(2)
                        }
                        Spacer(minLength: 8)
                        friendButton(person)
                    }
                }
            }
        }
    }

    /// Creators in the family who aren't you or your friends, original first.
    private var strangers: [User] {
        let root = RemixLineage.root(of: bubble, in: bubbleStore.bubbles)
        let family = [root] + RemixLineage.descendants(of: root, in: bubbleStore.bubbles)
        var seen: Set<String> = []
        return family.map(\.creator).filter { user in
            guard user.id != appStore.me.id, !user.isMe, !user.isFriend, user.kind == .person else { return false }
            return seen.insert(user.id).inserted
        }
        .prefix(3)
        .map { $0 }
    }

    @ViewBuilder
    private func friendButton(_ person: User) -> some View {
        if person.friendship == .requestSent {
            Text(RemixCopy.requested)
                .font(.fbCaptionEmphasized)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.horizontal, 10)
                .frame(minHeight: 32)
                .background(FBColor.buttonGray, in: Capsule())
        } else {
            Button {
                Haptics.light()
                withAnimation(.easeInOut(duration: 0.2)) { appStore.sendRequest(to: person) }
                BubbleSocialSignals.post(.addFriendFromGame, bubbleID: bubble.id, with: [person.id])
            } label: {
                Label(person.friendship == .requestReceived ? RemixCopy.confirm : RemixCopy.addFriend, systemImage: "person.badge.plus")
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 32))
            .accessibilityLabel(RemixCopy.addFriendLabel(person.name))
        }
    }
}

/// "Remix of Hill Hopper by Diego", as a pill on light surfaces.
struct RemixCreditPill: View {
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "wand.and.sparkles")
                .font(.system(size: FBIconSize.small, weight: .semibold))
            Text(text)
                .font(.fbCaptionEmphasized)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(FBColor.accent)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(FBColor.tintedBlueBackground, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The tree screen

/// `feature:remix/tree/<id>`: the whole remix family of a Bubble, with Remix, Share and Send it
/// back. Notification taps ("Diego remixed Moving Day") open it.
struct RemixTreeScreen: View {
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var showShare = false
    @State private var showSendBack = false

    var body: some View {
        Group {
            if let bubble = bubbleStore.bubble(id: bubbleID) {
                content(bubble)
            } else {
                ContentUnavailableView(RemixCopy.notFound, systemImage: "bubbles.and.sparkles", description: Text(RemixCopy.cardUnavailable))
            }
        }
        .background(FBColor.surface)
        .navigationTitle(RemixCopy.treeNavTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ bubble: Bubble) -> some View {
        let tree = RemixLineage.tree(around: bubble, in: bubbleStore.bubbles, maxDepth: 4, maxNodes: 40)
        let friends = RemixLineage.descendants(of: tree.root, in: bubbleStore.bubbles).filter { $0.creator.isFriend }.count
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(bubble, tree: tree, friends: friends)
                if tree.totalRemixes == 0 {
                    Text(RemixCopy.treeEmpty)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .padding(.vertical, 8)
                }
                RemixTreeView(bubble: bubble, maxDepth: 4, maxNodes: 40)
                    .padding(8)
                    .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                Text(RemixCopy.treeIntro)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                RemixPeopleRow(bubble: bubble)
                actions(bubble)
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.vertical, 16)
        }
        .sheet(isPresented: $showShare) {
            RemixShareSheet(bubble: bubble)
        }
        .sheet(isPresented: $showSendBack) {
            RemixSendBackSheet(bubbleID: bubble.id)
        }
    }

    private func header(_ bubble: Bubble, tree: RemixLineage.Tree, friends: Int) -> some View {
        HStack(alignment: .top, spacing: 12) {
            BubbleCoverView(bubble: tree.root, showsEmoji: true)
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(tree.root.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text(RemixCopy.treeSubtitle(tree.totalRemixes, friends: friends))
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(FBColor.secondaryText)
                if let credit = RemixLineage.credit(for: bubble, store: bubbleStore), bubble.id != tree.root.id {
                    Text(bubble.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .padding(.top, 4)
                    RemixCreditPill(text: credit)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func actions(_ bubble: Bubble) -> some View {
        VStack(spacing: 8) {
            if RemixSendBack.canSendBack(bubble, store: bubbleStore) {
                Button {
                    Haptics.light()
                    showSendBack = true
                } label: {
                    Label(sendBackLabel(bubble), systemImage: RemixCenter.shared.sentBack.contains(bubble.id) ? "checkmark" : "arrowshape.turn.up.backward.fill")
                }
                .buttonStyle(.fb(.primary, height: 44))
            }
            HStack(spacing: 8) {
                Button {
                    Haptics.light()
                    RemixNav.openStudio(remixing: bubble.id, router: router, dismiss: isSheet ? { dismiss() } : nil)
                } label: {
                    Label(RemixCopy.remixIt, systemImage: "wand.and.sparkles")
                }
                .buttonStyle(.fb(.tinted, height: 44))
                .accessibilityHint(RemixCopy.remixHint(bubble.title))
                Button {
                    Haptics.light()
                    showShare = true
                } label: {
                    Label(RemixCopy.share, systemImage: "arrowshape.turn.up.right")
                }
                .buttonStyle(.fb(.secondary, height: 44))
            }
        }
    }

    private var isSheet: Bool { router.bubbleSheet?.feature == .remix }

    private func sendBackLabel(_ bubble: Bubble) -> String {
        let name = RemixLineage.originalCreator(of: bubble, store: bubbleStore)?.firstName ?? ""
        return RemixCenter.shared.sentBack.contains(bubble.id) ? RemixCopy.sentBackTo(name) : RemixCopy.sendBackTo(name)
    }
}

// MARK: - Navigation helpers

/// Leaving covers before opening another: the player, Messenger and feature sheets all sit on the
/// same root view, which presents one at a time.
@MainActor
enum RemixNav {
    /// Opens Studio remixing `bubbleID`, closing Messenger, a feature sheet, or the sheet this
    /// call comes from (`dismiss`) first.
    static func openStudio(remixing bubbleID: String, router: Router, dismiss: (() -> Void)? = nil) {
        leavingCovers(router: router, dismiss: dismiss) {
            router.openStudio(StudioLaunch(mode: .remix, baseBubbleID: bubbleID))
        }
    }

    /// Runs `action` once nothing is covering the tabs.
    static func leavingCovers(router: Router, dismiss: (() -> Void)? = nil, _ action: @escaping () -> Void) {
        var closed = false
        if let dismiss {
            dismiss()
            closed = true
        }
        if router.bubbleSheet != nil {
            router.bubbleSheet = nil
            closed = true
        }
        if router.isMessengerPresented {
            router.isMessengerPresented = false
            closed = true
        }
        if closed {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() }
        } else {
            action()
        }
    }
}
