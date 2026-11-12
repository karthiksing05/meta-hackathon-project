import SwiftUI

/// Like / Comment / Share. Tap Like to like (or remove a reaction). Press and hold Like for
/// the reaction picker: drag across it and release on a reaction to choose it, release away
/// from it to cancel, or release without moving to keep it open and tap one.
struct PostActionBar: View {
    let post: Post
    @Binding var isPickerOpen: Bool
    var onComment: () -> Void
    var onShare: () -> Void

    @Environment(AppStore.self) private var store

    @State private var hovered: ReactionType?
    @State private var likeScale: CGFloat = 1
    @State private var pickerSession = 0

    /// The picker's top-left corner in the Like button's coordinate space.
    private static var pickerOrigin: CGPoint {
        CGPoint(x: 4, y: -(PostReactionPicker.height() + 8))
    }

    var body: some View {
        HStack(spacing: 0) {
            likeButton
                .zIndex(1)
            actionButton(title: "Comment", symbol: "bubble.right", action: onComment)
            actionButton(title: "Share", symbol: "arrowshape.turn.up.right", action: onShare)
        }
        .padding(.horizontal, 4)
        .onDisappear {
            if isPickerOpen {
                isPickerOpen = false
            }
            hovered = nil
        }
    }

    // MARK: Like

    private var likeButton: some View {
        likeLabel
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .contentShape(Rectangle())
            .gesture(likeGesture)
            .overlay(alignment: .topLeading) {
                if isPickerOpen {
                    PostReactionPicker(hovered: hovered) { reaction in
                        choose(reaction)
                    }
                    .offset(x: Self.pickerOrigin.x, y: Self.pickerOrigin.y)
                    .transition(.scale(scale: 0.5, anchor: .bottomLeading).combined(with: .opacity))
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(likeAccessibilityLabel)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction {
                tapLike()
            }
            .accessibilityActions {
                ForEach(ReactionType.allCases) { reaction in
                    Button(reaction.title) {
                        choose(reaction)
                    }
                }
            }
    }

    private var likeLabel: some View {
        HStack(spacing: 6) {
            likeIcon
                .scaleEffect(likeScale)
            Text(likeTitle)
                .font(.fbButton)
        }
        .foregroundStyle(likeColor)
    }

    @ViewBuilder
    private var likeIcon: some View {
        switch post.myReaction {
        case .none:
            Image(systemName: "hand.thumbsup")
                .font(.system(size: FBIconSize.regular))
        case .some(.like):
            Image(systemName: "hand.thumbsup.fill")
                .font(.system(size: FBIconSize.regular))
        case .some(let reaction):
            Text(reaction.emoji)
                .font(.system(size: FBIconSize.regular))
        }
    }

    private var likeTitle: String {
        post.myReaction?.title ?? "Like"
    }

    private var likeColor: Color {
        post.myReaction?.color ?? FBColor.secondaryText
    }

    private var likeAccessibilityLabel: String {
        if let reaction = post.myReaction {
            return "\(reaction.title), selected"
        }
        return "Like"
    }

    /// Hold 0.35 s, then drag; a quick tap falls through to the tap gesture.
    private var likeGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.35)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .onChanged { value in
                guard case .second(_, let drag) = value else { return }
                if !isPickerOpen {
                    openPicker()
                }
                if let drag {
                    updateHover(drag)
                }
            }
            .onEnded { value in
                guard case .second(_, let drag) = value else { return }
                finishPress(drag)
            }
            .exclusively(before: TapGesture().onEnded { tapLike() })
    }

    // MARK: Other buttons

    private func actionButton(title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.regular))
                Text(title)
                    .font(.fbButton)
            }
            .foregroundStyle(FBColor.secondaryText)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Actions

    private func tapLike() {
        if isPickerOpen {
            closePicker()
            return
        }
        let isLiking = post.myReaction == nil
        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
            store.toggleLike(post)
        }
        if isLiking {
            Haptics.light()
            pop()
        } else {
            Haptics.soft()
        }
    }

    private func choose(_ reaction: ReactionType) {
        Haptics.light()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
            store.setReaction(reaction, on: post)
        }
        closePicker()
        pop()
    }

    private func pop() {
        withAnimation(.spring(response: 0.18, dampingFraction: 0.45)) {
            likeScale = 1.35
        }
        Task {
            try? await Task.sleep(nanoseconds: 160_000_000)
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                likeScale = 1
            }
        }
    }

    private func openPicker() {
        Haptics.medium()
        hovered = nil
        pickerSession += 1
        withAnimation(.spring(response: 0.32, dampingFraction: 0.72)) {
            isPickerOpen = true
        }
    }

    private func closePicker() {
        withAnimation(.easeOut(duration: 0.18)) {
            isPickerOpen = false
            hovered = nil
        }
    }

    /// A picker left open by a press without a drag closes itself after a few seconds.
    private func scheduleAutoClose() {
        let session = pickerSession
        Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if isPickerOpen && pickerSession == session {
                closePicker()
            }
        }
    }

    private func updateHover(_ drag: DragGesture.Value) {
        let moved = abs(drag.translation.width) + abs(drag.translation.height)
        // Nothing is hovered until the finger starts to move, like the real picker.
        guard hovered != nil || moved > 8 else { return }
        let index = PostReactionPicker.index(at: drag.location, origin: Self.pickerOrigin)
        let reaction = index.map { ReactionType.allCases[$0] }
        guard reaction != hovered else { return }
        if reaction != nil {
            Haptics.selection()
        }
        withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
            hovered = reaction
        }
    }

    private func finishPress(_ drag: DragGesture.Value?) {
        if let reaction = hovered {
            choose(reaction)
            return
        }
        let moved = drag.map { abs($0.translation.width) + abs($0.translation.height) } ?? 0
        if moved > 16 {
            closePicker()
        } else {
            scheduleAutoClose()
        }
    }
}

/// The floating row of the seven reactions. Items pop in one after another; the hovered
/// one grows and shows its name above it.
struct PostReactionPicker: View {
    var hovered: ReactionType? = nil
    var itemSize: CGFloat = 38
    var onSelect: ((ReactionType) -> Void)? = nil

    @State private var appeared = false

    static let spacing: CGFloat = 4
    static let padding: CGFloat = 6

    static func height(itemSize: CGFloat = 38) -> CGFloat {
        itemSize + padding * 2
    }

    static func width(itemSize: CGFloat = 38) -> CGFloat {
        let count = CGFloat(ReactionType.allCases.count)
        return count * itemSize + (count - 1) * spacing + padding * 2
    }

    /// The index of the reaction under `point`, where the picker's top-left corner is at `origin`
    /// in the same coordinate space. Far above or below the picker nothing is hovered.
    static func index(at point: CGPoint, origin: CGPoint, itemSize: CGFloat = 38) -> Int? {
        let x = point.x - origin.x - padding
        let y = point.y - origin.y
        let rowWidth = width(itemSize: itemSize) - padding * 2
        guard y > -70, y < height(itemSize: itemSize) + 40 else { return nil }
        guard x > -spacing * 2, x < rowWidth + spacing * 2 else { return nil }
        let slot = Int((x / (itemSize + spacing)).rounded(.down))
        return min(max(slot, 0), ReactionType.allCases.count - 1)
    }

    var body: some View {
        HStack(spacing: Self.spacing) {
            ForEach(Array(ReactionType.allCases.enumerated()), id: \.element) { index, reaction in
                item(reaction, index: index)
            }
        }
        .padding(Self.padding)
        .background {
            Capsule()
                .fill(FBColor.elevated)
                .shadow(color: .black.opacity(0.2), radius: 10, y: 3)
        }
        .fixedSize()
        .onAppear {
            appeared = true
        }
    }

    private func item(_ reaction: ReactionType, index: Int) -> some View {
        let isHovered = hovered == reaction
        return Button {
            onSelect?(reaction)
        } label: {
            ReactionBadge(type: reaction, size: itemSize, showsBorder: false)
        }
        .buttonStyle(.plain)
        .scaleEffect(itemScale(isHovered: isHovered), anchor: .bottom)
        .offset(y: isHovered ? -12 : 0)
        .overlay(alignment: .top) {
            if isHovered {
                Text(reaction.title)
                    .font(.fbMicroEmphasized)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.72), in: Capsule())
                    .fixedSize()
                    .offset(y: -(itemSize * 0.5 + 34))
                    .transition(.opacity)
            }
        }
        .scaleEffect(appeared ? 1 : 0.2, anchor: .bottom)
        .opacity(appeared ? 1 : 0)
        .animation(.spring(response: 0.36, dampingFraction: 0.58).delay(Double(index) * 0.035), value: appeared)
        .zIndex(isHovered ? 1 : 0)
        .accessibilityLabel(reaction.title)
    }

    private func itemScale(isHovered: Bool) -> CGFloat {
        if isHovered {
            return 1.45
        }
        return hovered == nil ? 1 : 0.88
    }
}
