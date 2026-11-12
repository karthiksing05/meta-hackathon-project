import SwiftUI
import PhotosUI

/// Edit profile screen (pushed). Edits are local copies until "Save".
struct EditProfileView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    enum Field: Hashable {
        case firstName, lastName, bio, city, hometown, work, school, website
    }

    private static let bioLimit = 101
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
        Haptics.success()
        dismiss()
    }

    // MARK: Cards

    private var profilePictureCard: some View {
        EditCard(title: "Profile picture", action: {
            PhotosPicker(selection: $avatarItem, matching: .images) {
                EditActionLabel(title: "Edit")
            }
        }) {
            AvatarView(user: store.me, size: 120)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
    }

    private var coverCard: some View {
        EditCard(title: "Cover photo", action: {
            PhotosPicker(selection: $coverItem, matching: .images) {
                EditActionLabel(title: "Edit")
            }
        }) {
            RemoteImage(url: store.me.coverURL, data: store.me.coverData)
                .frame(maxWidth: .infinity)
                .frame(height: 160)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private var bioCard: some View {
        EditCard(title: "Bio", action: {
            Button {
                focus = .bio
            } label: {
                EditActionLabel(title: bio.isEmpty ? "Add" : "Edit")
            }
            .buttonStyle(.plain)
        }) {
            VStack(alignment: .trailing, spacing: 6) {
                TextField("Describe who you are", text: $bio, axis: .vertical)
                    .font(.fbBodyLarge)
                    .lineLimit(2...5)
                    .focused($focus, equals: .bio)
                    .padding(12)
                    .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text("\(bio.count)/\(EditProfileView.bioLimit)")
                    .font(.fbMeta)
                    .foregroundStyle(bio.count >= EditProfileView.bioLimit ? FBColor.notificationRed : FBColor.secondaryText)
            }
        }
    }

    private var detailsCard: some View {
        EditCard(title: "Details", action: {
            Button {
                focus = .city
            } label: {
                EditActionLabel(title: (city.isEmpty && work.isEmpty && school.isEmpty) ? "Add" : "Edit")
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
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var nameCard: some View {
        EditCard(title: "Name", action: {
            Button {
                focus = .firstName
            } label: {
                EditActionLabel(title: "Edit")
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
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct EditActionLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.fbBody)
            .foregroundStyle(FBColor.accent)
    }
}

private struct EditCard<Action: View, Content: View>: View {
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
