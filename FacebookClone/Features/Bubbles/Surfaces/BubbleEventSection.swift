import SwiftUI

/// The Bubbles block on an Event page: the icebreaker card and "Make an icebreaker".
struct BubbleEventSection: View {
    let event: FBEvent

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        VStack(spacing: 0) {
            if let bubble = bubbleStore.worldIcebreaker(for: event) {
                BubbleEventIcebreakerCard(event: event, bubble: bubble)
                    .padding(12)
                    .background(FBColor.surface)
            }
            if event.response == .going {
                BubbleEventMakeRow(event: event)
            }
        }
    }
}

/// "Who's coming Saturday? Learn a few names before you go."
struct BubbleEventIcebreakerCard: View {
    let event: FBEvent
    let bubble: Bubble

    @Environment(AppStore.self) private var store
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    private var weekday: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE"
        return formatter.string(from: event.startDate)
    }

    /// People going, from the demo roster when this is the picnic, else friends going.
    private var attendees: [User] {
        if event.id == DemoWorld.eventID, let world = DemoWorld.shared {
            let ids = world.people.filter { $0.goingToPicnic }.map { $0.id }
            let users = ids.compactMap { store.user(id: $0) }
            if !users.isEmpty { return users }
        }
        return event.friendsGoing
    }

    var body: some View {
        let palette = BubbleGlow.palette(bubble.paletteID)
        let players = bubbleStore.worldPlayers(of: bubble)
        let played = players.contains { $0.isMe }
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                BubbleOrb(size: 18, tint: palette.glow)
                Text("Icebreaker")
                    .font(.fbCaptionEmphasized)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.ink.opacity(0.75))
                Spacer(minLength: 0)
                if bubble.isMadeWithMuse { MuseBadge(compact: true) }
            }
            HStack(spacing: 12) {
                BubbleCoverView(bubble: bubble)
                    .frame(width: 76, height: 76)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Who's coming \(weekday)?")
                        .font(.fbHeadline)
                        .foregroundStyle(palette.ink)
                    Text("Learn a few names before you go")
                        .font(.fbBody)
                        .foregroundStyle(palette.ink.opacity(0.8))
                }
                Spacer(minLength: 0)
            }
            if !attendees.isEmpty {
                HStack(spacing: 8) {
                    AvatarStack(users: attendees, size: FBAvatarSize.comment, maxCount: 6)
                    Text("\(event.goingCount) going")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(palette.ink)
                }
            }
            Button {
                Haptics.light()
                router.play(bubble.id)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill")
                    Text(played ? "Play again" : "Play the icebreaker")
                }
                .font(.fbButton)
                .foregroundStyle(palette.isDark ? BubbleGlow.ink : Color.white)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(palette.isDark ? AnyShapeStyle(Color.white.opacity(0.92)) : AnyShapeStyle(palette.ink), in: Capsule())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Play the icebreaker, \(bubble.title)")

            HStack(spacing: 8) {
                if players.isEmpty {
                    Text("Nobody has played yet. Be the first.")
                } else {
                    AvatarStack(users: players, size: FBAvatarSize.reply, maxCount: 5)
                    Text(playedText(players))
                }
            }
            .font(.fbMeta)
            .foregroundStyle(palette.ink.opacity(0.85))
        }
        .padding(14)
        .background(palette.gradient, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(0.55), lineWidth: 1))
        .bubbleGlow(palette.top, radius: 10, opacity: 0.35)
        .accessibilityElement(children: .contain)
    }

    private func playedText(_ players: [User]) -> String {
        let names = players.map { $0.isMe ? "You" : $0.firstName }
        switch names.count {
        case 1: return "\(names[0]) played"
        case 2: return "\(names[0]) and \(names[1]) played"
        default: return "\(names[0]), \(names[1]) and \(names.count - 2) more played"
        }
    }
}

/// "Make an icebreaker" for an Event you're going to.
struct BubbleEventMakeRow: View {
    let event: FBEvent

    @Environment(Router.self) private var router

    var body: some View {
        Button {
            Haptics.light()
            router.openStudio(StudioLaunch(eventID: event.id))
        } label: {
            HStack(spacing: 12) {
                BubbleOrb(size: 34)
                    .padding(6)
                    .background(BubbleGlow.brandGradient.opacity(0.55), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Make an icebreaker")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("A quick game so guests learn each other's names")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(FBColor.surface)
            .overlay(alignment: .top) { HairlineDivider() }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Make an icebreaker")
    }
}
