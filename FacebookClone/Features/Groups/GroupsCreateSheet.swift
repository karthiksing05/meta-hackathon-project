import SwiftUI

private enum GroupsPrivacyChoice: String, CaseIterable, Identifiable {
    case isPublic = "Public"
    case isPrivate = "Private"

    var id: String { rawValue }
}

/// "Create group" sheet: name, privacy, invite friends.
struct GroupsCreateSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var privacy: GroupsPrivacyChoice = .isPrivate
    @State private var invited: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    fields
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Invite friends")
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.primaryText)
                            .padding(.horizontal, 16)
                        GroupsFriendSelectionList(selection: $invited)
                    }
                }
                .padding(.top, 16)
            }
            .background(FBColor.surface)
            .navigationTitle("Create group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Create") {
                        dismiss()
                        store.showToast("Group creation isn't available in this demo", symbol: "info.circle")
                    }
                    .fontWeight(.semibold)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Group name", text: $name)
                .font(.fbBodyLarge)
                .padding(.horizontal, 12)
                .frame(height: 48)
                .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            Picker("Privacy", selection: $privacy) {
                ForEach(GroupsPrivacyChoice.allCases) { choice in
                    Text(choice.rawValue).tag(choice)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: privacy) {
                Haptics.selection()
            }
            Text(privacy == .isPrivate
                 ? "Only members can see who's in the group and what they post."
                 : "Anyone can see who's in the group and what they post.")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
        }
        .padding(.horizontal, 16)
    }
}
