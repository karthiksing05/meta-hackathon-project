import SwiftUI

// People in the make flow: who a game is for (Describe) and who gets challenged (Share).

/// Overlapping avatars, like Facebook's mutual-friends stacks.
struct StudioFaceStack: View {
    let people: [User]
    var size: CGFloat = FBAvatarSize.comment
    var limit = 5

    var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(Array(people.prefix(limit).enumerated()), id: \.element.id) { index, person in
                AvatarView(user: person, size: size)
                    .overlay(Circle().strokeBorder(StudioGlow.base, lineWidth: 2))
                    .zIndex(Double(limit - index))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Describe, people first: who this game is for, with their faces, above the prompt. Launched from
/// a Group or an Event it names them; for friends it shows friends; for everyone it offers to make
/// it for friends instead.
struct StudioAudienceFaces: View {
    let model: StudioModel

    var body: some View {
        content
            .gameAppear()
    }

    @ViewBuilder
    private var content: some View {
        switch model.audience {
        case .group:
            if let group = model.audienceGroup {
                row(
                    leading: AnyView(StudioGroupThumbnail(group: group, size: FBAvatarSize.post)),
                    title: "For \(group.name)",
                    people: group.memberSample,
                    subtitle: peopleLine(group.memberSample, total: group.memberCount, verb: "will play it")
                )
            }
        case .event:
            if let event = model.audienceEvent {
                row(
                    leading: AnyView(StudioEventDateTile(date: event.startDate)),
                    title: "For \(StudioModel.shortTitle(of: event))",
                    people: event.friendsGoing,
                    subtitle: event.friendsGoing.isEmpty ? StudioEventDateTile.subtitle(for: event) : peopleLine(event.friendsGoing, total: event.friendsGoing.count, verb: "are going")
                )
            }
        case .friends:
            let friends = model.friendChoices
            row(leading: nil, title: "For your friends", people: friends, subtitle: peopleLine(friends, total: friends.count, verb: "can play and challenge you"))
        case .everyone:
            if model.showsAudiencePicker, !model.friendChoices.isEmpty {
                Button {
                    Haptics.selection()
                    withAnimation(GameMotion.appear) { model.setAudience(.friends) }
                } label: {
                    row(
                        leading: nil,
                        title: "Make it for friends?",
                        people: model.friendChoices,
                        subtitle: peopleLine(model.friendChoices, total: model.friendChoices.count, verb: "could play it first"),
                        showsChevron: true
                    )
                }
                .buttonStyle(.plain)
                .accessibilityHint("Makes this \(ProductName.singular) for your friends")
            }
        }
    }

    private func row(leading: AnyView?, title: String, people: [User], subtitle: String, showsChevron: Bool = false) -> some View {
        HStack(spacing: FBSpacing.m) {
            if let leading { leading }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            if !people.isEmpty {
                StudioFaceStack(people: people, size: FBAvatarSize.comment, limit: 4)
            }
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.tertiaryText)
                    .accessibilityHidden(true)
            }
        }
        .studioCard(padding: FBSpacing.m)
        .accessibilityElement(children: .combine)
    }

    /// "Maya, Diego and 8 others will play it".
    private func peopleLine(_ people: [User], total: Int, verb: String) -> String {
        let names = people.prefix(2).map(\.firstName)
        guard !names.isEmpty else { return "" }
        let others = max(0, total - names.count)
        let list: String
        if others > 0 {
            list = names.joined(separator: ", ") + " and \(others.fbCompact) \(others == 1 ? "other" : "others")"
        } else {
            list = MakeRecord.names(Array(names))
        }
        return "\(list) \(verb)"
    }
}

/// Share: pick the friends to challenge. Tapping a face toggles it; picked faces wear a check.
struct StudioFriendPicker: View {
    let model: StudioModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: FBSpacing.m) {
                ForEach(model.friendChoices) { person in
                    face(person)
                }
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Friends to challenge")
    }

    private func face(_ person: User) -> some View {
        let picked = model.challengeIDs.contains(person.id)
        return Button {
            Haptics.selection()
            withAnimation(GameMotion.tap) { model.toggleFriend(person.id) }
        } label: {
            VStack(spacing: 6) {
                AvatarView(user: person, size: 56)
                    .overlay {
                        Circle()
                            .strokeBorder(picked ? AnyShapeStyle(GameColor.rim) : AnyShapeStyle(Color.clear), lineWidth: 3)
                            .padding(-4)
                    }
                    .overlay(alignment: .bottomTrailing) {
                        if picked {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .heavy)) // Small check inside a 20 pt badge
                                .foregroundStyle(.white)
                                .frame(width: 20, height: 20)
                                .background(GameColor.deepFill, in: Circle())
                                .overlay(Circle().strokeBorder(StudioGlow.base, lineWidth: 2))
                                .offset(x: 2, y: 2)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                Text(person.firstName)
                    .font(picked ? .fbCaptionEmphasized : .fbCaption)
                    .foregroundStyle(picked ? FBColor.primaryText : FBColor.secondaryText)
                    .lineLimit(1)
            }
            .frame(width: 64)
            .padding(.top, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(person.name)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }
}
