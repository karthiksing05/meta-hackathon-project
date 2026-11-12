import SwiftUI

private enum EventsFilter: String, CaseIterable, Identifiable {
    case forYou = "For you"
    case yourEvents = "Your events"
    case local = "Local"
    case weekend = "This weekend"

    var id: String { rawValue }
}

struct EventsView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var filter: EventsFilter = .forYou

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                chips
                list
            }
        }
        .background(FBColor.background)
        .navigationTitle("Events")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(EventsFilter.allCases) { item in
                    ChipView(title: item.rawValue, isSelected: filter == item) {
                        filter = item
                    }
                }
                ChipView(title: "Create", symbol: "plus") {
                    store.showToast("Event creation isn't available in this demo", symbol: "info.circle")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(FBColor.surface)
    }

    private var filteredEvents: [FBEvent] {
        let events = store.upcomingEvents
        switch filter {
        case .forYou:
            return events
        case .yourEvents:
            return events.filter { $0.response != nil }
        case .local:
            return events.filter { !$0.isOnline }
        case .weekend:
            let limit = Date().addingTimeInterval(7 * 86_400)
            return events.filter { Calendar.current.isDateInWeekend($0.startDate) && $0.startDate < limit }
        }
    }

    @ViewBuilder
    private var list: some View {
        let events = filteredEvents
        if events.isEmpty {
            ContentUnavailableView(
                emptyTitle,
                systemImage: "calendar",
                description: Text(emptyMessage)
            )
            .padding(.top, 50)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(events) { event in
                    EventsCard(event: event)
                }
            }
            .padding(12)
        }
    }

    private var emptyTitle: String {
        filter == .yourEvents ? "No events yet" : "No events found"
    }

    private var emptyMessage: String {
        switch filter {
        case .yourEvents: return "Events you're going to or interested in will show up here."
        case .weekend: return "There's nothing happening this weekend. Check back soon."
        default: return "Check back later for events near you."
        }
    }
}

private struct EventsCard: View {
    let event: FBEvent
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: Route.event(event)) {
                VStack(alignment: .leading, spacing: 0) {
                    cover
                    info
                }
            }
            .buttonStyle(.plain)
            actions
        }
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var cover: some View {
        ZStack {
            LinearGradient(colors: [FBColor.eventRed, FBColor.savedPurple], startPoint: .topLeading, endPoint: .bottomTrailing)
            RemoteImage(url: event.coverURL, placeholder: .clear)
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(event.startDate.eventStyle.uppercased())
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(FBColor.eventRed)
            Text(event.title)
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.leading)
                .lineLimit(2)
            Text(event.isOnline ? "Online event" : event.locationName)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .lineLimit(1)
            Text("\(event.interestedCount.fbCompact) interested · \(event.goingCount.fbCompact) going")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button {
                Haptics.light()
                store.respond(to: event, with: .interested)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: event.response == .interested ? "star.fill" : "star")
                    Text(buttonTitle)
                }
            }
            .buttonStyle(.fb(event.response == nil ? .secondary : .tinted))
            ShareLink(item: "\(event.title) · \(event.startDate.eventStyle)") {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 44, height: 36)
                    .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
            }
            .accessibilityLabel("Share event")
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
    }

    private var buttonTitle: String {
        if let response = event.response {
            return response.title
        }
        return "Interested"
    }
}

#Preview {
    NavigationStack { EventsView() }.previewEnvironment()
}
