import SwiftUI

enum WatchPalette {
    static let navy = Color(hex: "#07141E")
    static let forest = Color(hex: "#142B39")
    static let sage = Color(hex: "#91ADBA")
    static let orange = Color(hex: "#D3C3A5")
    static let beige = Color(hex: "#B8C3C9")
    static let cream = Color(hex: "#F2F0EA")
    static let negative = Color(hex: "#C77A72")
}

private extension Color {
    init(hex: String) {
        var raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") {
            raw.removeFirst()
        }
        guard raw.count == 6, let value = Int(raw, radix: 16) else {
            self = .clear
            return
        }
        self = Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
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
            .background(WatchPalette.forest, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
            )
    }
}

struct WatchSectionLabel: View {
    let title: String
    let icon: String

    var body: some View {
        Label(title, systemImage: icon)
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
