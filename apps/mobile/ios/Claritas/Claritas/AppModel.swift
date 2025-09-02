import Foundation
import Combine

@MainActor
final class AppModel: ObservableObject {
    @Published var selectedCountry: String? = nil
    @Published var news: [NewsItem] = []
    @Published var countryStats: [CountryStat] = []
    @Published var weather: [CountryWeather] = []
    @Published var isRefreshingWeather: Bool = false

    let api: APIClient

    init() {
        self.api = APIClient()
    }

    func loadInitial() async {
        async let stats = api.fetchCountryStats(days: 30)
        async let weath = api.fetchCountryWeather()
        async let newsItems = api.fetchNews(limit: 20, offset: 0, q: nil, country: nil)
        do {
            let (s, w, n) = try await (stats, weath, newsItems)
            self.countryStats = s
            self.weather = w
            self.news = n
        } catch {
            // Basic fallback: clear on failure
            self.countryStats = []
            self.weather = []
            self.news = []
        }
    }

    func reloadNewsForSelectedCountry() async {
        do {
            news = try await api.fetchNews(limit: 20, offset: 0, q: nil, country: selectedCountry)
        } catch {
            news = []
        }
    }

    func refreshWeatherNow() async {
        guard !isRefreshingWeather else { return }
        isRefreshingWeather = true
        defer { isRefreshingWeather = false }
        do {
            _ = try await api.ingestWeatherNow(country: selectedCountry)
            weather = try await api.fetchCountryWeather()
        } catch {
            // ignore
        }
    }
}

