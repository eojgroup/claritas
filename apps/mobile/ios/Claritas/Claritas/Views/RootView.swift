import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @State private var tab: Int = 0
    @AppStorage("THEME_DARK") private var dark: Bool = false

    var body: some View {
        Group {
            if model.authStatus == .authed {
                TabView(selection: $tab) {
                    NavigationStack {
                        DashboardView()
                            .navigationTitle("Claritas")
                            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ThemeToggle() } }
                    }
                    .tabItem { Label("Dashboard", systemImage: "globe") }
                    .tag(0)

                    NavigationStack {
                        AnalyticsView()
                            .navigationTitle("Analytics")
                    }
                    .tabItem { Label("Analytics", systemImage: "chart.pie") }
                    .tag(1)
                }
            } else {
                LoginView()
            }
        }
        .preferredColorScheme(dark ? .dark : .light)
        .task {
            await model.bootstrap()
        }
    }
}

struct ThemeToggle: View {
    @AppStorage("THEME_DARK") private var dark: Bool = false
    var body: some View {
        Button(action: { dark.toggle() }) {
            Image(systemName: dark ? "sun.max" : "moon")
        }
    }
}

struct AnalyticsView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Analytics placeholders")
                .font(.headline)
            Text("Scatter and pie charts can be added later.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .background(Color(.systemGroupedBackground))
    }
}
