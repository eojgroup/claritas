import SwiftUI

struct BrandBackground<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: colorScheme == .dark
                    ? [
                        Color(red: 0.06, green: 0.08, blue: 0.11),
                        Color(red: 0.04, green: 0.06, blue: 0.09)
                    ]
                    : [
                        Color(red: 0.98, green: 0.96, blue: 0.93),
                        Color(red: 0.93, green: 0.92, blue: 0.88)
                    ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(Color(red: 0.12, green: 0.42, blue: 0.4).opacity(colorScheme == .dark ? 0.26 : 0.18))
                .frame(width: 320, height: 320)
                .blur(radius: 20)
                .offset(x: -140, y: -220)

            Circle()
                .fill(Color(red: 0.83, green: 0.63, blue: 0.42).opacity(colorScheme == .dark ? 0.18 : 0.22))
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
                            .foregroundStyle(.secondary)
                    }
                    Text(title.uppercased())
                        .font(.caption2.weight(.semibold))
                        .tracking(3)
                        .foregroundStyle(.secondary)
                }
            }
            content
        }
        .padding(16)
        .background(Color(.systemBackground).opacity(0.92), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.primary.opacity(0.08)))
        .shadow(color: Color.black.opacity(0.08), radius: 16, x: 0, y: 10)
    }
}
