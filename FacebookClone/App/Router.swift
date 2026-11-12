import Observation
import SwiftUI

enum AppTab: String, CaseIterable, Identifiable, Hashable {
    case home
    case video
    case friends
    case marketplace
    case notifications
    case menu

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .video: return "Video"
        case .friends: return "Friends"
        case .marketplace: return "Marketplace"
        case .notifications: return "Notifications"
        case .menu: return "Menu"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .video: return "play.tv"
        case .friends: return "person.2"
        case .marketplace: return "storefront"
        case .notifications: return "bell"
        case .menu: return "line.3.horizontal"
        }
    }

    var selectedSymbol: String {
        switch self {
        case .home: return "house.fill"
        case .video: return "play.tv.fill"
        case .friends: return "person.2.fill"
        case .marketplace: return "storefront.fill"
        case .notifications: return "bell.fill"
        case .menu: return "line.3.horizontal"
        }
    }
}

/// Every screen that can be pushed onto a tab's navigation stack.
/// Push with `NavigationLink(value: Route.profile(user))` or `router.push(.profile(user))`.
enum Route: Hashable {
    case profile(User)
    case post(Post)
    case group(FBGroup)
    case event(FBEvent)
    case listing(Listing)
    /// Used inside the Messenger cover. From elsewhere call `router.openChat(_:)`.
    case chat(Conversation)
    case friendsList(User)
    case friendRequests
    case friendSuggestions
    case editProfile
    /// Search screen, optionally pre-filled (for hashtags).
    case search(String)
    case saved
    case memories
    case birthdays
    case groups
    case events
    case feeds
    case pages
    case settings
    case marketplaceCategory(ListingCategory)
    case comingSoon(title: String, symbol: String)
}

enum ComposerStartAction: Hashable {
    case none
    case photo
    case feeling
    case tagPeople
    case checkIn
    case background
    case poll
}

/// What to open the post composer with.
struct CreatePostRequest: Identifiable {
    let id = UUID()
    /// Post into this group.
    var group: FBGroup? = nil
    /// Write on this person's profile (birthday wishes).
    var timelineOwner: User? = nil
    /// Jump straight to a tool, e.g. the photo picker.
    var startAction: ComposerStartAction = .none
    /// "Share > Write post".
    var sharedPost: Post? = nil
    /// Edit an existing post instead of creating one.
    var editingPost: Post? = nil
}

struct ReelsRequest: Identifiable {
    let id = UUID()
    var startReelID: String? = nil
}

/// App-wide navigation state: selected tab, each tab's stack, and full-screen flows.
@Observable
final class Router {
    var selectedTab: AppTab = .home
    var paths: [AppTab: NavigationPath] = [:]
    /// Bumped when the user taps the tab that is already selected at the root.
    var scrollToTopSignals: [AppTab: Int] = [:]

    var messengerPath = NavigationPath()
    var isMessengerPresented = false
    var createPostRequest: CreatePostRequest? = nil
    var isCreateStoryPresented = false
    var isCreateMenuPresented = false
    var reelsRequest: ReelsRequest? = nil

    func path(for tab: AppTab) -> Binding<NavigationPath> {
        Binding(
            get: { self.paths[tab] ?? NavigationPath() },
            set: { self.paths[tab] = $0 }
        )
    }

    /// Selects a tab. Tapping the current tab pops to its root, then scrolls to the top.
    func select(_ tab: AppTab) {
        guard selectedTab == tab else {
            selectedTab = tab
            return
        }
        if let path = paths[tab], !path.isEmpty {
            paths[tab] = NavigationPath()
        } else {
            scrollToTopSignals[tab, default: 0] += 1
        }
    }

    func scrollToTopSignal(for tab: AppTab) -> Int {
        scrollToTopSignals[tab] ?? 0
    }

    /// Pushes onto the selected tab's stack.
    func push(_ route: Route) {
        var path = paths[selectedTab] ?? NavigationPath()
        path.append(route)
        paths[selectedTab] = path
    }

    func popToRoot(_ tab: AppTab? = nil) {
        paths[tab ?? selectedTab] = NavigationPath()
    }

    func openMessenger() {
        messengerPath = NavigationPath()
        isMessengerPresented = true
    }

    func openChat(_ conversation: Conversation) {
        var path = NavigationPath()
        path.append(Route.chat(conversation))
        messengerPath = path
        isMessengerPresented = true
    }

    func composePost(_ request: CreatePostRequest = CreatePostRequest()) {
        createPostRequest = request
    }

    func openReels(startingAt reel: Post? = nil) {
        reelsRequest = ReelsRequest(startReelID: reel?.id)
    }

    func openCreateStory() {
        isCreateStoryPresented = true
    }
}

extension View {
    /// Registers every `Route` destination. Call once, on the root view inside each NavigationStack.
    func appDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            RouteDestination(route: route)
        }
    }
}

struct RouteDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .profile(let user):
            ProfileView(user: user)
        case .post(let post):
            PostDetailView(post: post)
        case .group(let group):
            GroupDetailView(group: group)
        case .event(let event):
            EventDetailView(event: event)
        case .listing(let listing):
            ListingDetailView(listing: listing)
        case .chat(let conversation):
            ChatView(conversation: conversation)
        case .friendsList(let user):
            AllFriendsView(user: user)
        case .friendRequests:
            FriendRequestsView()
        case .friendSuggestions:
            FriendSuggestionsView()
        case .editProfile:
            EditProfileView()
        case .search(let query):
            SearchView(initialQuery: query)
        case .saved:
            SavedView()
        case .memories:
            MemoriesView()
        case .birthdays:
            BirthdaysView()
        case .groups:
            GroupsView()
        case .events:
            EventsView()
        case .feeds:
            FeedsView()
        case .pages:
            PagesView()
        case .settings:
            SettingsView()
        case .marketplaceCategory(let category):
            MarketplaceCategoryView(category: category)
        case .comingSoon(let title, let symbol):
            ComingSoonView(title: title, symbol: symbol)
        }
    }
}
