import Foundation

extension Int {
    /// 950 -> "950", 1_234 -> "1.2K", 12_500 -> "12K", 1_500_000 -> "1.5M".
    var fbCompact: String {
        let value = Double(self)
        switch abs(self) {
        case 0..<1_000:
            return "\(self)"
        case 1_000..<10_000:
            return Self.oneDecimal(value / 1_000) + "K"
        case 10_000..<1_000_000:
            return "\(self / 1_000)K"
        case 1_000_000..<10_000_000:
            return Self.oneDecimal(value / 1_000_000) + "M"
        default:
            return "\(self / 1_000_000)M"
        }
    }

    /// 1250 -> "1,250".
    var withCommas: String {
        Self.decimalFormatter.string(from: NSNumber(value: self)) ?? "\(self)"
    }

    private static let decimalFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter
    }()

    private static func oneDecimal(_ value: Double) -> String {
        let truncated = (value * 10).rounded(.down) / 10
        if truncated == truncated.rounded() {
            return String(Int(truncated))
        }
        return String(format: "%.1f", truncated)
    }
}

extension Double {
    /// Seconds to a clock string: 65 -> "1:05", 3725 -> "1:02:05".
    var clockString: String {
        guard isFinite, self >= 0 else { return "0:00" }
        let total = Int(self.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }
}

enum DateFormatters {
    static let monthDay: DateFormatter = make("MMM d")
    static let monthDayYear: DateFormatter = make("MMM d, yyyy")
    static let fullMonthDay: DateFormatter = make("MMMM d")
    static let fullMonthDayYear: DateFormatter = make("MMMM d, yyyy")
    static let weekday: DateFormatter = make("EEEE")
    static let weekdayShort: DateFormatter = make("EEE")
    static let monthYear: DateFormatter = make("MMMM yyyy")
    static let monthShort: DateFormatter = make("MMM")
    static let dayNumber: DateFormatter = make("d")

    static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()

    private static func make(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = format
        return formatter
    }
}

extension Date {
    /// Feed style: "Just now", "5m", "3h", "2d", "Mar 3", "Mar 3, 2023".
    var fbShort: String {
        let seconds = Date().timeIntervalSince(self)
        if seconds < 60 { return "Just now" }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 7 { return "\(days)d" }
        if Calendar.current.isDate(self, equalTo: Date(), toGranularity: .year) {
            return DateFormatters.monthDay.string(from: self)
        }
        return DateFormatters.monthDayYear.string(from: self)
    }

    /// Long style: "Just now", "12 minutes ago", "Yesterday at 4:12 PM", "Monday at 9:00 AM", "March 3 at 2:00 PM".
    var fbLong: String {
        let seconds = Date().timeIntervalSince(self)
        if seconds < 60 { return "Just now" }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return minutes == 1 ? "1 minute ago" : "\(minutes) minutes ago" }
        let hours = minutes / 60
        let calendar = Calendar.current
        if calendar.isDateInToday(self) { return hours == 1 ? "1 hour ago" : "\(hours) hours ago" }
        let time = DateFormatters.time.string(from: self)
        if calendar.isDateInYesterday(self) { return "Yesterday at \(time)" }
        if seconds < 6 * 86_400 { return "\(DateFormatters.weekday.string(from: self)) at \(time)" }
        if calendar.isDate(self, equalTo: Date(), toGranularity: .year) {
            return "\(DateFormatters.fullMonthDay.string(from: self)) at \(time)"
        }
        return DateFormatters.fullMonthDayYear.string(from: self)
    }

    /// Messenger chat list style: "4:12 PM", "Mon", "Mar 3".
    var messengerShort: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(self) { return DateFormatters.time.string(from: self) }
        if Date().timeIntervalSince(self) < 6 * 86_400 { return DateFormatters.weekdayShort.string(from: self) }
        return DateFormatters.monthDay.string(from: self)
    }

    /// "4:12 PM".
    var timeOfDay: String { DateFormatters.time.string(from: self) }

    /// Event style: "Sat, Nov 15 at 7:00 PM".
    var eventStyle: String {
        "\(DateFormatters.weekdayShort.string(from: self)), \(DateFormatters.monthDay.string(from: self)) at \(timeOfDay)"
    }
}
