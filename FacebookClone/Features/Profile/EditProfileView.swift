import SwiftUI
import PhotosUI

/// Edit profile screen (pushed). Edits are local copies until "Save".
struct EditProfileView: View {
    @Environment(AppStore.self) private var store
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.dismiss) private var dismiss

    enum Field: Hashable {
        case firstName, lastName, bio, city, hometown, work, school, website
    }

    private static let bioLimit = 101
    /// Cover colors to pick instead of a photo (`coverColor` on the server), pastel blue to violet.
    private static let coverColors = ["#B6E3F4", "#9CC9FF", "#7A8CFF", "#9B8CFF", "#C0AEDE", "#D1D4F9"]
    private static let relationshipOptions = [
        "Single", "In a relationship", "Engaged", "Married", "It's complicated", "Prefer not to say",
    ]

    @State private var firstName = ""
    @State private var lastName = ""
    @State private var bio = ""
    @State private var city = ""
    @State private var hometown = ""
    @State private var work = ""
    @State private var school = ""
    @State private var relationship = ""
    @State private var website = ""
    @State private var coverColor: String?
    @State private var loaded = false
    @State private var showDiscard = false
    @State private var avatarItem: PhotosPickerItem?
    @State private var coverItem: PhotosPickerItem?
    @FocusState private var focus: Field?

    private var hasChanges: Bool {
        let me = store.me
        return firstName != me.firstName
            || lastName != me.lastName
            || bio != me.bio
            || city != me.city
            || hometown != me.hometown
            || work != me.work
            || school != me.school
            || relationship != me.relationship
            || website != (me.website ?? "")
            || coverColor != me.coverColor
    }

    private var canSave: Bool {
        !firstName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                profilePictureCard
                coverCard
                bioCard
                detailsCard
                nameCard
            }
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(FBColor.background)
        .navigationTitle("Edit profile")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") {
                    if hasChanges {
                        showDiscard = true
                    } else {
                        dismiss()
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") { save() }
                    .fontWeight(.semibold)
                    .disabled(!canSave)
            }
        }
        .confirmationDialog("Discard changes?", isPresented: $showDiscard, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) { dismiss() }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text("If you go back now, your edits won't be saved.")
        }
        .onFirstAppear { load() }
        .onChange(of: bio) { _, newValue in
            if newValue.count > EditProfileView.bioLimit {
                bio = String(newValue.prefix(EditProfileView.bioLimit))
            }
        }
        .onChange(of: avatarItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    store.updateProfilePicture(data)
                }
                avatarItem = nil
            }
        }
        .onChange(of: coverItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    store.updateCoverPhoto(data)
                }
                coverItem = nil
            }
        }
    }

    private func load() {
        guard !loaded else { return }
        let me = store.me
        firstName = me.firstName
        lastName = me.lastName
        bio = me.bio
        city = me.city
        hometown = me.hometown
        work = me.work
        school = me.school
        relationship = me.relationship
        website = me.website ?? ""
        coverColor = me.coverColor
        loaded = true
    }

    private func save() {
        let trimmedSite = website.trimmingCharacters(in: .whitespaces)
        store.updateProfile(
            firstName: firstName.trimmingCharacters(in: .whitespaces),
            lastName: lastName.trimmingCharacters(in: .whitespaces),
            bio: bio,
            city: city,
            hometown: hometown,
            work: work,
            school: school,
            relationship: relationship,
            website: trimmedSite.isEmpty ? nil : trimmedSite
        )
        let me = store.me
        let pickedColor = coverColor != me.coverColor ? coverColor : nil
        if let pickedColor {
            // A picked color replaces the cover photo.
            me.coverColor = pickedColor
            me.coverURL = nil
            me.coverData = nil
        }
        bubbleStore.saveMyProfile(displayName: me.name, bio: me.bio, coverColor: pickedColor)
        Haptics.success()
        dismiss()
    }

    // MARK: Cards

    private var profilePictureCard: some View {
        ProfileEditCard(title: "Profile picture", action: {
            PhotosPicker(selection: $avatarItem, matching: .images) {
                ProfileEditActionLabel(title: "Edit")
            }
        }) {
            AvatarView(user: store.me, size: FBAvatarSize.hero)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
    }

    private var coverCard: some View {
        ProfileEditCard(title: "Cover photo", action: {
            PhotosPicker(selection: $coverItem, matching: .images) {
                ProfileEditActionLabel(title: "Edit")
            }
        }) {
            VStack(alignment: .leading, spacing: 10) {
                coverPreview
                    .frame(maxWidth: .infinity)
                    .frame(height: 160)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                coverColorRow
            }
        }
    }

    /// The picked color, else the photo.
    @ViewBuilder
    private var coverPreview: some View {
        let showsColor = coverColor != store.me.coverColor || (store.me.coverURL == nil && store.me.coverData == nil)
        if showsColor, let color = Color(serverHex: coverColor) {
            LinearGradient(colors: [color, color.opacity(0.7)], startPoint: .topLeading, endPoint: .bottomTrailing)
        } else {
            RemoteImage(url: store.me.coverURL, data: store.me.coverData)
        }
    }

    private var coverColorRow: some View {
        HStack(spacing: 10) {
            Text("Or a color")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            ForEach(EditProfileView.coverColors, id: \.self) { hex in
                let isSelected = coverColor?.uppercased() == hex
                Button {
                    Haptics.selection()
                    coverColor = hex
                } label: {
                    Circle()
                        .fill(Color(serverHex: hex) ?? FBColor.skeleton)
                        .frame(width: 28, height: 28)
                        .overlay {
                            Circle().strokeBorder(isSelected ? FBColor.brandBlue : FBColor.divider, lineWidth: isSelected ? 3 : 1)
                        }
                        .frame(width: 36, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cover color \(hex)")
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }

    private var bioCard: some View {
        ProfileEditCard(title: "Bio", action: {
            Button {
                focus = .bio
            } label: {
                ProfileEditActionLabel(title: bio.isEmpty ? "Add" : "Edit")
            }
            .buttonStyle(.plain)
        }) {
            VStack(alignment: .trailing, spacing: 6) {
                TextField("Describe who you are", text: $bio, axis: .vertical)
                    .font(.fbBodyLarge)
                    .lineLimit(2...5)
                    .focused($focus, equals: .bio)
                    .padding(12)
                    .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                Text("\(bio.count)/\(EditProfileView.bioLimit)")
                    .font(.fbMeta)
                    .foregroundStyle(bio.count >= EditProfileView.bioLimit ? FBColor.notificationRed : FBColor.secondaryText)
            }
        }
    }

    private var detailsCard: some View {
        ProfileEditCard(title: "Details", action: {
            Button {
                focus = .city
            } label: {
                ProfileEditActionLabel(title: (city.isEmpty && work.isEmpty && school.isEmpty) ? "Add" : "Edit")
            }
            .buttonStyle(.plain)
        }) {
            VStack(spacing: 10) {
                editField("house.fill", "Current city", $city, .city)
                editField("mappin.and.ellipse", "Hometown", $hometown, .hometown)
                editField("briefcase.fill", "Workplace", $work, .work)
                editField("graduationcap.fill", "School", $school, .school)
                relationshipRow
                editField("link", "Website", $website, .website)
            }
        }
    }

    private var relationshipRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "heart.fill")
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 24)
            Text("Relationship")
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.primaryText)
            Spacer()
            Picker("Relationship", selection: $relationship) {
                Text("None").tag("")
                ForEach(EditProfileView.relationshipOptions, id: \.self) { option in
                    Text(option).tag(option)
                }
            }
            .labelsHidden()
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    private var nameCard: some View {
        ProfileEditCard(title: "Name", action: {
            Button {
                focus = .firstName
            } label: {
                ProfileEditActionLabel(title: "Edit")
            }
            .buttonStyle(.plain)
        }) {
            VStack(spacing: 10) {
                editField("person.fill", "First name", $firstName, .firstName)
                editField("person.fill", "Last name", $lastName, .lastName)
            }
        }
    }

    private func editField(_ symbol: String, _ placeholder: String, _ text: Binding<String>, _ field: Field) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 24)
            TextField(placeholder, text: text)
                .font(.fbBodyLarge)
                .focused($focus, equals: field)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }
}

private struct ProfileEditActionLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.fbBody)
            .foregroundStyle(FBColor.accent)
    }
}

private struct ProfileEditCard<Action: View, Content: View>: View {
    let title: String
    let action: Action
    let content: Content

    init(title: String, @ViewBuilder action: () -> Action, @ViewBuilder content: () -> Content) {
        self.title = title
        self.action = action()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                action
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
    }
}
