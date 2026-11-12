import SwiftUI

// Slot views for the "groups-search" feature (docs/BUBBLES.md 7.3). Owner: groups-search.
// Shared screens call these through the composites in Social/BubbleFeatureSlots.swift. Stubs from
// feat/base draw nothing; keep each struct's name and stored properties (its call signature).

/// Top of the Group's Games tab: Daily Bubble, weekly leaderboard, 'Challenge the Group', game night entry.
struct GroupsSearchGamesHub: View {
    let group: FBGroup

    var body: some View {
        EmptyView()
    }
}

/// Bottom of the Games tab: every game made for the Group.
struct GroupsSearchGamesList: View {
    let group: FBGroup

    var body: some View {
        EmptyView()
    }
}

/// A small weekly-leaderboard teaser in the Featured tab's Bubbles block.
struct GroupsSearchFeaturedTeaser: View {
    let group: FBGroup

    var body: some View {
        EmptyView()
    }
}
