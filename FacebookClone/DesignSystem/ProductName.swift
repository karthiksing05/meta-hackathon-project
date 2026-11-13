import Foundation

/// The name people see for the games feature. Every piece of user-facing brand text reads it from
/// here, so a rename is a one-line change. Code names never use it: types, files, JSON keys, env
/// vars and assets are named after what they are ("game", "studio"), not after the brand.
enum ProductName {
    /// The feature as a whole: tab title, headers, settings ("Whims").
    static let display = "Whims"
    /// One game ("a Whim").
    static let singular = "Whim"
    /// More than one game ("3 Whims", "Your Whims").
    static let plural = "Whims"

    /// The lowercase wordmark drawn at the top of the tab ("whims").
    static var wordmark: String { display.lowercased() }

    /// "a Whim" (or "an …" when the name starts with a vowel sound).
    static var withArticle: String { "\(article) \(singular)" }

    /// "A Whim", for the start of a sentence.
    static var withArticleCapitalized: String {
        let article = self.article
        return "\(article.prefix(1).uppercased())\(article.dropFirst()) \(singular)"
    }

    /// "1 Whim", "3 Whims".
    static func count(_ count: Int) -> String {
        "\(count) \(count == 1 ? singular : plural)"
    }

    private static var article: String {
        guard let first = singular.lowercased().first else { return "a" }
        return "aeiou".contains(first) ? "an" : "a"
    }
}
