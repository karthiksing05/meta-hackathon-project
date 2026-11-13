import Foundation

/// The name people see for the games feature. Every piece of user-facing brand text reads it from
/// here, so a rename is a one-line change. Code names never use it: types, files, JSON keys, env
/// vars and assets are named after what they are ("game", "studio"), not after the brand.
///
/// Naming (Karthik, 2026-11-13): the feature is "Muse Curios" and one game is "a Curio", with a
/// capital C. Where only one word fits (a tab, a button, a chip), use `short`. "Muse" on its own
/// means Meta's models, never the feature.
enum ProductName {
    /// The feature as a whole: headers, settings, navigation titles ("Muse Curios").
    static let display = "Muse Curios"
    /// The one-word name, where only one word fits: the tab, a chip, a button ("Curios").
    static let short = "Curios"
    /// One game ("a Curio").
    static let singular = "Curio"
    /// More than one game ("3 Curios", "Your Curios").
    static let plural = "Curios"

    /// The wordmark's two parts: "Muse" is drawn in ink, "Curios" in the brand gradient.
    static let wordmarkLead = "Muse"
    static let wordmarkTail = "Curios"

    /// The tagline, verbatim. Don't shorten or paraphrase it.
    static let tagline = "When the world is your muse, how will you create the content of tomorrow?"

    /// "a Curio" (or "an …" when the name starts with a vowel sound).
    static var withArticle: String { "\(article) \(singular)" }

    /// "A Curio", for the start of a sentence.
    static var withArticleCapitalized: String {
        let article = self.article
        return "\(article.prefix(1).uppercased())\(article.dropFirst()) \(singular)"
    }

    /// "1 Curio", "3 Curios".
    static func count(_ count: Int) -> String {
        "\(count) \(count == 1 ? singular : plural)"
    }

    private static var article: String {
        guard let first = singular.lowercased().first else { return "a" }
        return "aeiou".contains(first) ? "an" : "a"
    }
}
