import SwiftUI

enum WatchPalette {
    static let navy = Color(red: 0.09, green: 0.20, blue: 0.26)
    static let forest = Color(red: 0.12, green: 0.29, blue: 0.23)
    static let sage = Color(red: 0.55, green: 0.73, blue: 0.60)
    static let orange = Color(red: 0.85, green: 0.47, blue: 0.20)
    static let beige = Color(red: 0.82, green: 0.77, blue: 0.69)
    static let cream = Color(red: 1.00, green: 0.99, blue: 0.97)
    static let negative = Color(red: 0.85, green: 0.36, blue: 0.32)
}

struct WatchCard<Content: View>: View {
    @ViewBuilder let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.white.opacity(0.15), lineWidth: 0.5)
            )
    }
}

struct WatchSectionLabel: View {
    let title: String
    let icon: String

    var body: some View {
        Label(title.uppercased(), systemImage: icon)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(WatchPalette.sage)
    }
}

struct WatchRefreshStatus: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(statusColor)
                .frame(width: 5, height: 5)
            Text(statusText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var statusColor: Color {
        switch model.connectionState {
        case .ready: return WatchPalette.sage
        case .refreshing: return WatchPalette.orange
        case .waitingForPhone, .failed: return WatchPalette.negative
        }
    }

    private var statusText: String {
        switch model.connectionState {
        case .ready:
            return model.lastUpdated?.formatted(date: .omitted, time: .shortened) ?? "Ready"
        case .refreshing: return "Updating"
        case .waitingForPhone: return "Needs iPhone"
        case .failed: return "Cached"
        }
    }
}
