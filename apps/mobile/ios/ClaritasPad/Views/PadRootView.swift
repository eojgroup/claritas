import SwiftUI

struct PadRootView: View {
    enum Destination: String, CaseIterable, Hashable, Identifiable {
        case overview
        case dashboard
        case news
        case weather
        case markets
        case admin
        case profile
        case policies

        var id: String { rawValue }

        var title: String {
            switch self {
            case .overview: return "Signal desk"
            case .dashboard: return "Global dashboard"
            case .news: return "News intelligence"
            case .weather: return "Weather"
            case .markets: return "Markets"
            case .admin: return "Administration"
            case .profile: return "Profile"
            case .policies: return "Policies"
            }
        }

        var icon: String {
            switch self {
            case .overview: return "rectangle.3.group.fill"
            case .dashboard: return "globe.europe.africa.fill"
            case .news: return "newspaper.fill"
            case .weather: return "cloud.sun.fill"
            case .markets: return "chart.line.uptrend.xyaxis"
            case .admin: return "shield.lefthalf.filled"
            case .profile: return "person.crop.circle.fill"
            case .policies: return "doc.text.fill"
            }
        }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("THEME_DARK") private var dark = false
    @State private var destination: Destination? = .overview
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        Group {
            if model.authStatus == .authed {
                if !model.hasPaidAccess, model.authUser != nil {
                    PaywallView()
                } else {
                    NavigationSplitView(columnVisibility: $columnVisibility) {
                        sidebar
                    } detail: {
                        detail
                    }
                    .navigationSplitViewStyle(.balanced)
                }
            } else {
                LoginView()
            }
        }
        .preferredColorScheme(dark ? .dark : .light)
        .task {
            await model.bootstrap()
        }
        .task(id: refreshTaskKey) {
            guard model.authStatus == .authed, model.hasPaidAccess else { return }
            while !Task.isCancelled {
                await model.refreshMarketQuotes(forceRefresh: true)
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
        .onChange(of: model.isAdmin) { isAdmin in
            if !isAdmin && destination == .admin {
                destination = .overview
            }
        }
    }

    private var sidebar: some View {
        List(selection: $destination) {
            Section("Intelligence") {
                destinationLink(.overview)
                destinationLink(.dashboard)
            }
            Section("Signals") {
                destinationLink(.news)
                destinationLink(.weather)
                destinationLink(.markets)
            }
            if model.isAdmin {
                Section("Operations") {
                    destinationLink(.admin)
                }
            }
            Section("Account") {
                destinationLink(.profile)
                destinationLink(.policies)
            }
        }
        .navigationTitle("Claritas")
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            sidebarStatus
        }
    }

    private func destinationLink(_ item: Destination) -> some View {
        Label(item.title, systemImage: item.icon)
            .tag(item)
    }

    private var sidebarStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack(spacing: 8) {
                Circle()
                    .fill(ClaritasPalette.positiveText(for: colorScheme))
                    .frame(width: 7, height: 7)
                Text("Live workspace")
                    .font(.caption.weight(.semibold))
                Spacer()
                Button {
                    dark.toggle()
                } label: {
                    Image(systemName: dark ? "sun.max.fill" : "moon.fill")
                }
                .buttonStyle(.plain)
            }
            Text(model.authUser?.display_name ?? model.authUser?.email ?? "Signed in")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(14)
        .background(.ultraThinMaterial)
    }

    @ViewBuilder
    private var detail: some View {
        NavigationStack {
            Group {
                switch destination ?? .overview {
                case .overview:
                    PadOverviewView(destination: $destination)
                case .dashboard:
                    DashboardView()
                case .news:
                    NewsWorkspaceView()
                case .weather:
                    WeatherWorkspaceView()
                case .markets:
                    MarketsWorkspaceView()
                case .admin:
                    AdminWorkspaceView()
                case .profile:
                    ProfileView()
                case .policies:
                    PoliciesWorkspaceView()
                }
            }
            .navigationTitle((destination ?? .overview).title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if model.selectedCountry != nil || model.selectedSymbol != nil {
                        Button {
                            model.clearSelection()
                        } label: {
                            Label("Clear focus", systemImage: "xmark.circle")
                        }
                    }
                    Button {
                        Task { await model.loadInitial() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
            }
            .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
    }

    private var refreshTaskKey: String {
        "\(model.authStatus.rawValue)-\(model.hasPaidAccess)-ipad"
    }
}
