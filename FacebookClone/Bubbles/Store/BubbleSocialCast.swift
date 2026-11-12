import Foundation

/// The other side of every collaboration demo (docs/BUBBLES.md 7.1): synthetic people from the
/// New in SF demo world, the group chats they're in, and who plays the rival. All synthetic.
///
/// Shared by every collaboration feature. Don't edit in a feature branch; ask for additions.
enum BubbleSocialCast {
    /// The default rival for 1:1 challenges ("Maya beat your 34 with 41").
    static let rivalID = "sf-maya-okafor"
    /// A second frequent rival and remixer ("Leo remixed Hill Drift" uses whoever the feature
    /// picks; these are the demo world's ids).
    static let friendIDs = ["sf-diego-ramirez", "sf-aiko-tanaka", "sf-theo-adeyemi"]

    struct ChatSeed {
        let id: String
        let name: String
        let memberIDs: [String]
        /// Recent messages, oldest first: (sender id, text, minutes ago). "me" is you.
        let messages: [(String, String, Double)]
    }

    /// Group chats used for shared sessions, quiz nights and co-making.
    static let newInSFCrew = ChatSeed(
        id: "bubble-chat-newinsf-crew",
        name: "New in SF crew",
        memberIDs: ["sf-maya-okafor", "sf-diego-ramirez", "sf-priya-natarajan", "sf-chloe-nguyen"],
        messages: [
            ("sf-diego-ramirez", "Who's around for the picnic Saturday?", 180),
            ("sf-maya-okafor", "Me! Bringing the good bread", 172),
            ("sf-chloe-nguyen", "Count me in 🙌", 160),
            ("me", "Same, see you all there", 150),
        ]
    )

    static let picnicPlanners = ChatSeed(
        id: "bubble-chat-picnic-planners",
        name: "Picnic planners",
        memberIDs: ["sf-omar-haddad", "sf-lena-fischer", "sf-jordan-brooks"],
        messages: [
            ("sf-lena-fischer", "I can grab a big blanket", 300),
            ("sf-omar-haddad", "Snacks are on me", 290),
            ("sf-jordan-brooks", "I'll make a playlist", 240),
        ]
    )

    static let chats = [newInSFCrew, picnicPlanners]

    /// Adds the group chats to Messenger once (they survive only for this launch, like other mock
    /// chats). Members resolve through the Bubble store, so they always match the seeds.
    static func install(appStore: AppStore, bubbleStore: BubbleStore) {
        for seed in chats where !appStore.conversations.contains(where: { $0.id == seed.id }) {
            let members = seed.memberIDs.map { bubbleStore.resolvePerson($0) }.filter { !$0.isMe }
            guard members.count >= 2 else { continue }
            let now = Date()
            let messages = seed.messages.map { sender, text, minutes in
                Message(senderID: sender == "me" ? appStore.me.id : sender, text: text, sentAt: now.addingTimeInterval(-minutes * 60))
            }
            let chat = Conversation(id: seed.id, participants: members, groupName: seed.name, messages: messages)
            appStore.conversations.append(chat)
        }
    }

    /// The group chat for a seed, if installed.
    static func conversation(_ seed: ChatSeed, in appStore: AppStore) -> Conversation? {
        appStore.conversations.first { $0.id == seed.id }
    }

    /// The rival as a user.
    static func rival(_ bubbleStore: BubbleStore) -> User {
        bubbleStore.resolvePerson(rivalID)
    }

    /// New in SF's members from the demo world (not you), for Group leaderboards and game nights.
    static func groupMembers(_ bubbleStore: BubbleStore) -> [User] {
        (BubbleRoster.bundled?.people ?? []).map { bubbleStore.resolvePerson($0.id) }.filter { !$0.isMe }
    }
}
