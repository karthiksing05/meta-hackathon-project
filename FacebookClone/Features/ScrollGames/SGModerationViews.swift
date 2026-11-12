import SwiftUI

struct SGModerationReason: Decodable, Hashable {
    var category: String
    var severity: String
    var reason: String
    var source: String?

    enum CodingKeys: String, CodingKey { case category, severity, reason, source }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        category = c.flex(String.self, .category) ?? ""
        severity = c.flex(String.self, .severity) ?? "low"
        reason = c.flex(String.self, .reason) ?? ""
        source = c.flex(String.self, .source)
    }

    var label: String {
        let name = category.replacingOccurrences(of: "_", with: " ").capitalized
        return reason.isEmpty ? name : "\(name): \(reason)"
    }
}

/// The server's moderation verdict for a game (pass, pass-precheck-only, flagged, blocked).
struct SGModeration: Decodable, Hashable {
    var decision: String
    var reasons: [SGModerationReason]
    var checker: String?

    enum CodingKeys: String, CodingKey { case decision, reasons, checker }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        decision = c.flex(String.self, .decision) ?? "pass"
        reasons = c.flex([SGModerationReason].self, .reasons) ?? []
        checker = c.flex(String.self, .checker)
    }

    var isBlocked: Bool { decision == "blocked" }
    var isFlagged: Bool { decision == "flagged" }

    /// One honest line for the publish screen.
    var summary: String {
        switch decision {
        case "pass": return checker == "seed" ? "Seeded demo game" : "Checked by Muse: passed"
        case "pass-precheck-only": return "Muse was unavailable. Passed basic checks only."
        case "flagged": return "Checked by Muse: flagged for review"
        case "blocked": return "Checked by Muse: blocked"
        default: return "Moderation: \(decision)"
        }
    }
}

/// Verdict line under the Publish button; for flagged and blocked games it lists the reasons.
struct SGModerationNote: View {
    let moderation: SGModeration?
    let onEditBrief: () -> Void

    var body: some View {
        if let moderation {
            VStack(alignment: .leading, spacing: FBSpacing.xs) {
                Label(moderation.summary, systemImage: symbol(moderation))
                    .font(.fbCaption)
                    .foregroundStyle(moderation.isBlocked ? FBColor.notificationRed : FBColor.secondaryText)
                if moderation.isFlagged {
                    Text("It will publish, but only you can see it until it is reviewed.")
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                }
                if moderation.isBlocked || moderation.isFlagged {
                    ForEach(Array(moderation.reasons.enumerated()), id: \.offset) { _, reason in
                        Text("\u{2022} \(reason.label)")
                            .font(.fbCaption)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                if moderation.isBlocked {
                    Button("Edit brief", action: onEditBrief)
                        .buttonStyle(.fb(.secondary, expand: false, height: 32))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        } else {
            Text("Content check runs when you publish")
                .font(.fbCaption)
                .foregroundStyle(FBColor.tertiaryText)
        }
    }

    private func symbol(_ moderation: SGModeration) -> String {
        switch moderation.decision {
        case "blocked": return "xmark.octagon.fill"
        case "flagged": return "flag.fill"
        case "pass-precheck-only": return "exclamationmark.shield"
        default: return "checkmark.shield.fill"
        }
    }
}

/// Reasons a player can give when reporting a game.
enum SGReportReason: String, CaseIterable, Identifiable {
    case spam, offensive, personalInfo, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .spam: return "Spam"
        case .offensive: return "Offensive"
        case .personalInfo: return "Personal info"
        case .other: return "Other"
        }
    }

    var apiValue: String {
        switch self {
        case .personalInfo: return "personal info"
        default: return rawValue
        }
    }
}
