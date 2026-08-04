import assert from "node:assert/strict";
import test from "node:test";

test("standard OpenWeather responses retain current detail and derive daily forecasts", async () => {
  process.env.DB_HOST ||= "127.0.0.1";
  process.env.DB_NAME ||= "claritas_test";
  process.env.DB_USER ||= "claritas_test";
  process.env.DB_PASSWORD ||= "claritas_test";
  const { normalizeStandardWeather } = await import("./openweather");
  const result = normalizeStandardWeather(
    {
      coord: { lat: 51.5, lon: -0.1 },
      weather: [{ id: 500, main: "Rain", description: "light rain", icon: "10d" }],
      main: { temp: 18, feels_like: 17, pressure: 1008, humidity: 72 },
      visibility: 9000,
      wind: { speed: 4, deg: 220, gust: 7 },
      clouds: { all: 80 },
      rain: { "1h": 0.4 },
      dt: 1_786_000_000,
      sys: { sunrise: 1_785_980_000, sunset: 1_786_040_000 },
      timezone: 3600,
      name: "London",
    },
    {
      city: { name: "London", timezone: 3600, coord: { lat: 51.5, lon: -0.1 } },
      list: [
        { dt: 1_786_003_600, main: { temp: 17, feels_like: 16, humidity: 75 }, pop: 0.4, rain: { "3h": 1.2 }, wind: { speed: 5, gust: 8 }, weather: [{ id: 500, main: "Rain" }] },
        { dt: 1_786_014_400, main: { temp: 21, feels_like: 20, humidity: 60 }, pop: 0.8, rain: { "3h": 2.4 }, wind: { speed: 6, gust: 10 }, weather: [{ id: 501, main: "Rain" }] },
      ],
    },
  );

  assert.equal(result.current?.temp, 18);
  assert.equal(result.current?.visibility, 9000);
  assert.equal(result.hourly?.length, 2);
  assert.equal(result.daily?.length, 1);
  assert.equal(result.daily?.[0]?.temp?.min, 17);
  assert.equal(result.daily?.[0]?.temp?.max, 21);
  assert.equal(result.daily?.[0]?.pop, 0.8);
  assert.ok(Math.abs((result.daily?.[0]?.rain ?? 0) - 3.6) < 0.0001);
  assert.equal(result.daily?.[0]?.wind_gust, 10);
});
