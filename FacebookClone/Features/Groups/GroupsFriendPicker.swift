import SwiftUI

/// A multi-select list of friends with check circles. Embed it in a form or sheet.
struct GroupsFriendSelectionList: View {
    @Binding var selection: Set<String>
    @Environment(AppStore.self) private var store

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(store.friends) { friend in
                row(friend)
            }
        }
    }

    private func row(_ friend: User) -> some View {
        let isSelected = selection.contains(friend.id)
        return Button {
            Haptics.selection()
            if isSelected {
                selection.remove(friend.id)
            } else {
                selection.insert(friend.id)
            }
        } label: {
            HStack(spacing: 12) {
                AvatarView(user: friend, size: FBAvatarSize.post)
                Text(friend.name)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: FBIconSize.xl))
                    .foregroundStyle(isSelected ? FBColor.brandBlue : FBColor.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// A sheet that lets the user pick friends, then confirm.
struct GroupsFriendPickerSheet: View {
    let title: String
    let confirmTitle: String
    let onConfirm: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selection: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                GroupsFriendSelectionList(selection: $selection)
                    .padding(.top, 4)
            }
            .background(FBColor.surface)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(confirmTitle) {
                        let count = selection.count
                        dismiss()
                        onConfirm(count)
                    }
                    .fontWeight(.semibold)
                    .disabled(selection.isEmpty)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}
