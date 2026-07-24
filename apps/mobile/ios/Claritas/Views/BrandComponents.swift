import SwiftUI

enum ClaritasPalette {
    static let darkBlue = Color(hex: "#172F42")
    static let darkGreen = Color(hex: "#2A5268")
    static let lightGreen = Color(hex: "#A9CEDC")
    static let sage = Color(hex: "#77A8BA")
    static let orange = Color(hex: "#E6A06A")
    static let orangeStrong = Color(hex: "#B87547")
    static let grey = Color(hex: "#53616A")
    static let beige = Color(hex: "#D5C1A4")
    static let brown = orangeStrong
    static let offWhite = Color(hex: "#FFFAF1")
    static let text = Color(hex: "#172F42")

    static let positive = darkGreen
    static let negative = Color(hex: "#A73B32")

    static func shellBackground(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#081119") : Color(hex: "#F3E9D7")
    }

    static func shellBackgroundElevated(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#0C1822") : Color(hex: "#E8D9C2")
    }

    static func shellSurface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#11222E").opacity(0.90) : Color(hex: "#FFFAF1").opacity(0.76)
    }

    static func shellRaised(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#152A38").opacity(0.96) : Color(hex: "#FFFAF1").opacity(0.94)
    }

    static func shellSurfaceMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#1B303E").opacity(0.82) : Color(hex: "#E9DCC8").opacity(0.78)
    }

    static func shellBorder(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B9CAD2").opacity(0.13) : darkBlue.opacity(0.17)
    }

    static func shellBorderStrong(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B9CAD2").opacity(0.25) : darkBlue.opacity(0.32)
    }

    static func shellInk(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#F2EEE6") : text
    }

    static func shellMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#A9B5BA") : grey
    }

    static func shellSidebar(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#071018") : Color(hex: "#10293A")
    }

    static func shellHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#EDA36A").opacity(0.16) : Color(hex: "#F3CDAA")
    }

    static func shellAccent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#EDA36A") : orange
    }

    static func shellAccentSecondary(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#77A8BA") : Color(hex: "#3E6A80")
    }

    static func positiveText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#77A8BA") : darkGreen
    }

    static func negativeText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D96B62") : Color(hex: "#A73B32")
    }

    static func dataBlue(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#77A8BA") : Color(hex: "#3E6A80")
    }

    static func glassHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color.white.opacity(0.14) : Color.white.opacity(0.72)
    }
}

enum ClaritasLayout {
    static let minimumTouchTarget: CGFloat = 44
    static let controlRadius: CGFloat = 10
    static let panelRadius: CGFloat = 14
    static let sectionSpacing: CGFloat = 16
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
                    ClaritasPalette.shellBackgroundElevated(for: colorScheme),
                    ClaritasPalette.shellBackground(for: colorScheme),
                    colorScheme == .dark
                        ? Color(hex: "#081119")
                        : Color(hex: "#EFE1CF")
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    ClaritasPalette.shellAccentSecondary(for: colorScheme).opacity(colorScheme == .dark ? 0.08 : 0.07),
                    Color.clear,
                    ClaritasPalette.shellAccent(for: colorScheme).opacity(colorScheme == .dark ? 0.1 : 0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

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
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }
            content
        }
        .padding(16)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }
}

struct BrandSectionHeader: View {
    let kicker: String
    let title: String
    let detail: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(kicker)
                .font(.caption.weight(.semibold))
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
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
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
        .brandGlass(cornerRadius: 16)
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
                tone == nil ? ClaritasPalette.shellInk(for: colorScheme) : ClaritasPalette.offWhite
            )
    }
}

struct BrandGlassModifier: ViewModifier {
    let cornerRadius: CGFloat
    let elevated: Bool
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(elevated
                        ? ClaritasPalette.shellRaised(for: colorScheme)
                        : ClaritasPalette.shellSurface(for: colorScheme))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        elevated
                            ? ClaritasPalette.shellBorderStrong(for: colorScheme)
                            : ClaritasPalette.shellBorder(for: colorScheme),
                        lineWidth: 0.5
                    )
            )
            .shadow(
                color: Color.black.opacity(colorScheme == .dark ? 0.16 : 0.05),
                radius: elevated ? 8 : 3,
                x: 0,
                y: elevated ? 4 : 1
            )
    }
}

extension View {
    func brandGlass(cornerRadius: CGFloat = 18, elevated: Bool = false) -> some View {
        modifier(BrandGlassModifier(cornerRadius: cornerRadius, elevated: elevated))
    }
}
