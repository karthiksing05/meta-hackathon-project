import MapKit
import SwiftUI

struct EventDetailView: View {
    let event: FBEvent

    @Environment(AppStore.self) private var store

    @State private var showFullAbout = false
    @State private var showInvite = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                cover
                titleBlock
                responseButtons
                FeedSeparator()
                detailRows
                if !event.details.isEmpty {
                    FeedSeparator()
                    aboutSection
                }
                if !event.friendsGoing.isEmpty {
                    FeedSeparator()
                    friendsSection
                }
                FeedSeparator()
                hostSection
                FeedSeparator()
                guestCounts
            }
        }
        .background(FBColor.background)
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showInvite) {
            GroupsFriendPickerSheet(title: "Invite friends", confirmTitle: "Send") { _ in
                store.showToast("Invites sent", symbol: "paperplane.fill")
            }
        }
    }

    // MARK: Top

    private var cover: some View {
        ZStack {
            LinearGradient(colors: [FBColor.eventRed, FBColor.savedPurple], startPoint: .topLeading, endPoint: .bottomTrailing)
            RemoteImage(url: event.coverURL, placeholder: .clear)
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    private var titleBlock: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Text(DateFormatters.monthShort.string(from: event.startDate).uppercased())
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(FBColor.eventRed)
                Text(DateFormatters.dayNumber.string(from: event.startDate))
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(FBColor.primaryText)
            }
            .frame(width: 52, height: 56)
            .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(event.startDate.eventStyle)
                    .font(.fbMeta.weight(.semibold))
                    .foregroundStyle(FBColor.eventRed)
                Text(event.title)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FBColor.primaryText)
                Text("Event by \(event.hostName)")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(FBColor.surface)
    }

    private var responseButtons: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                ForEach(EventResponse.allCases) { option in
                    responseButton(option)
                }
            }
            HStack(spacing: 8) {
                Button {
                    showInvite = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "envelope")
                        Text("Invite")
                    }
                }
                .buttonStyle(.fbSecondary)
                moreMenu
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .background(FBColor.surface)
    }

    private func responseButton(_ option: EventResponse) -> some View {
        let selected = event.response == option
        return Button {
            Haptics.light()
            store.respond(to: event, with: option)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: option.symbol)
                Text(option.title)
            }
            .font(.system(size: 14, weight: .semibold))
        }
        .buttonStyle(.fb(selected ? .tinted : .secondary))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var moreMenu: some View {
        Menu {
            Button {
                store.showToast("Added to your calendar", symbol: "calendar.badge.plus")
            } label: {
                Label("Add to calendar", systemImage: "calendar.badge.plus")
            }
            Button {
                UIPasteboard.general.string = "https://facebook.com/events/\(event.id)"
                store.showToast("Link copied", symbol: "link")
            } label: {
                Label("Copy link", systemImage: "link")
            }
            ShareLink(item: "\(event.title) · \(event.startDate.eventStyle)") {
                Label("Share", systemImage: "square.and.arrow.up")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(FBColor.primaryText)
                .frame(width: 44, height: 36)
                .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
        }
        .accessibilityLabel("More options")
    }

    // MARK: Rows

    private var detailRows: some View {
        VStack(alignment: .leading, spacing: 16) {
            infoRow(
                symbol: "person.2.fill",
                text: "\(event.interestedCount.fbCompact) interested · \(event.goingCount.fbCompact) going"
            )
            if event.isOnline {
                infoRow(symbol: "video.fill", text: "Online event")
            } else {
                locationBlock
            }
            infoRow(
                symbol: event.isPrivate ? "lock.fill" : "globe.americas.fill",
                text: event.isPrivate ? "Private · Only invited people can see this event" : "Public · Anyone on or off Facebook"
            )
            if !event.category.isEmpty {
                infoRow(symbol: "tag.fill", text: event.category)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private func infoRow(symbol: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 18))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 26)
            Text(text)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
    }

    private var locationBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 18))
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.locationName)
                        .font(.fbBodyLarge)
                        .foregroundStyle(FBColor.primaryText)
                    if !event.address.isEmpty {
                        Text(event.address)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                Spacer(minLength: 0)
            }
            map
        }
    }

    private var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: event.latitude, longitude: event.longitude)
    }

    private var map: some View {
        let region = MKCoordinateRegion(
            center: coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        )
        return Map(initialPosition: .region(region)) {
            Marker(event.locationName, coordinate: coordinate)
        }
        .frame(height: 160)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .allowsHitTesting(false)
    }

    // MARK: Sections

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("About")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            Text(event.details)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(showFullAbout ? nil : 4)
            if !showFullAbout && event.details.count > 160 {
                Button("See more") {
                    withAnimation { showFullAbout = true }
                }
                .font(.fbBody.weight(.semibold))
                .foregroundStyle(FBColor.secondaryText)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private var friendsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Friends going")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            HStack(spacing: 10) {
                AvatarStack(users: event.friendsGoing, size: 32, maxCount: 5)
                Text(friendNames)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(2)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private var friendNames: String {
        let names = event.friendsGoing.map { $0.firstName }
        switch names.count {
        case 0: return ""
        case 1: return "\(names[0]) is going"
        case 2: return "\(names[0]) and \(names[1]) are going"
        default: return "\(names[0]), \(names[1]) and \(names.count - 2) other friends are going"
        }
    }

    private var hostSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Meet your host")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
            HStack(spacing: 12) {
                Circle()
                    .fill(FBColor.tintedBlueBackground)
                    .frame(width: 48, height: 48)
                    .overlay {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 26))
                            .foregroundStyle(FBColor.brandBlue)
                    }
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.hostName)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Event host")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer()
                Button {
                    store.showToast("Message sent to \(event.hostName)", symbol: "paperplane.fill")
                } label: {
                    Text("Message")
                }
                .buttonStyle(.fb(.secondary, expand: false))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }

    private var guestCounts: some View {
        HStack {
            countCell(value: event.goingCount, title: "Going")
            countCell(value: event.interestedCount, title: "Interested")
            countCell(value: event.friendsGoing.count, title: "Friends")
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .background(FBColor.surface)
    }

    private func countCell(value: Int, title: String) -> some View {
        VStack(spacing: 2) {
            Text(value.fbCompact)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(FBColor.primaryText)
            Text(title)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .frame(maxWidth: .infinity)
    }
}
