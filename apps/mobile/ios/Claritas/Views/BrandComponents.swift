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

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    ClaritasPalette.offWhite,
                    ClaritasPalette.beige.opacity(0.9)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(ClaritasPalette.darkGreen.opacity(0.15))
                .frame(width: 320, height: 320)
                .blur(radius: 20)
                .offset(x: -140, y: -220)

            Circle()
                .fill(ClaritasPalette.brown.opacity(0.18))
                .frame(width: 260, height: 260)
                .blur(radius: 18)
                .offset(x: 150, y: -260)

            content
        }
    }
}

struct BrandCard<Content: View>: View {
    let title: String?
    let icon: String?
    @ViewBuilder var content: Content

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
                            .foregroundStyle(ClaritasPalette.grey)
                    }
                    Text(title.uppercased())
                        .font(.caption2.weight(.semibold))
                        .tracking(3)
                        .foregroundStyle(ClaritasPalette.grey)
                }
            }
            content
        }
        .padding(16)
        .background(ClaritasPalette.offWhite.opacity(0.94), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(ClaritasPalette.beige, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 8)
    }
}
