import SwiftUI

enum ClaritasPalette {
    static let darkBlue = Color(hex: "#1F3A5F")
    static let darkGreen = Color(hex: "#2F5D50")
    static let grey = Color(hex: "#5B6166")
    static let beige = Color(hex: "#E8DDC8")
    static let brown = Color(hex: "#7A5C46")
    static let offWhite = Color(hex: "#F7F3EC")
    static let text = Color(hex: "#222222")

    static let positive = darkGreen
    static let negative = Color(red: 0.72, green: 0.23, blue: 0.23)

    static func shellBackground(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#0F1722") : offWhite
    }

    static func shellSurface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#172434") : Color(hex: "#FFFDFA")
    }

    static func shellRaised(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#1E3045") : Color.white.opacity(0.96)
    }

    static func shellBorder(for scheme: ColorScheme) -> Color {
        scheme == .dark ? beige.opacity(0.18) : beige
    }

    static func shellInk(for scheme: ColorScheme) -> Color {
        scheme == .dark ? offWhite : text
    }

    static func shellMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B5C2D1") : grey
    }

    static func shellSidebar(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#12233A") : darkBlue
    }

    static func shellHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? darkGreen.opacity(0.28) : darkGreen.opacity(0.12)
    }
}

extension Color {
    init(hex: String) {
        var raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") {
            raw.removeFirst()
        }
        if raw.count == 3 {
            raw = raw.map { "\($0)\($0)" }.joined()
        }
        guard raw.count == 6, let value = Int(raw, radix: 16) else {
            self = .clear
            return
        }
        let red = Double((value >> 16) & 0xFF) / 255
        let green = Double((value >> 8) & 0xFF) / 255
        let blue = Double(value & 0xFF) / 255
        self = Color(red: red, green: green, blue: blue)
    }
}

struct BrandBackground<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.colorScheme) private var colorScheme

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    ClaritasPalette.shellBackground(for: colorScheme),
                    colorScheme == .dark
                        ? ClaritasPalette.shellSidebar(for: colorScheme).opacity(0.92)
                        : ClaritasPalette.beige.opacity(0.88)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(ClaritasPalette.darkGreen.opacity(0.15))
                .frame(width: 320, height: 320)
                .blur(radius: 28)
                .offset(x: -140, y: -220)

            Circle()
                .fill(ClaritasPalette.brown.opacity(0.18))
                .frame(width: 260, height: 260)
                .blur(radius: 24)
                .offset(x: 150, y: -260)

            Circle()
                .fill(ClaritasPalette.darkBlue.opacity(colorScheme == .dark ? 0.22 : 0.1))
                .frame(width: 280, height: 280)
                .blur(radius: 30)
                .offset(x: 180, y: 280)

            content
        }
    }
}

struct BrandCard<Content: View>: View {
    let title: String?
    let icon: String?
    @ViewBuilder var content: Content
    @Environment(\.colorScheme) private var colorScheme

    init(title: String? = nil, icon: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack(spacing: 8) {
                    if let icon {
                        Image(systemName: icon)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                    Text(title.uppercased())
                        .font(.caption2.weight(.semibold))
                        .tracking(3)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }
            content
        }
        .padding(16)
        .background(ClaritasPalette.shellRaised(for: colorScheme), in: RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 8)
    }
}

struct BrandSectionHeader: View {
    let kicker: String
    let title: String
    let detail: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(kicker.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(3)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            }
        }
    }
}

struct BrandMetricCard: View {
    let title: String
    let value: String
    let detail: String?
    let tone: Color?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(2.6)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(tone ?? ClaritasPalette.shellInk(for: colorScheme))
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(ClaritasPalette.shellSurface(for: colorScheme))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
        )
    }
}

struct BrandPill: View {
    let label: String
    let tone: Color?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                (tone ?? ClaritasPalette.shellHighlight(for: colorScheme)),
                in: Capsule()
            )
            .foregroundStyle(
                tone == nil
                    ? ClaritasPalette.shellInk(for: colorScheme)
                    : ClaritasPalette.offWhite
            )
    }
}
