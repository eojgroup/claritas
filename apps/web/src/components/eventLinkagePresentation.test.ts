import { describe, expect, it } from "vitest";
import { presentEventLinkage, signalDomainLabel } from "./eventLinkagePresentation";

describe("event linkage presentation", () => {
  it("discloses anchored matching factors without claiming causation", () => {
    const presentation = presentEventLinkage(0.87, {
      decision: "attached",
      location: 1,
      temporal: 0.92,
      event_type: 1,
      country: 1,
    });

    expect(presentation.label).toBe("Likely linked");
    expect(presentation.shortReason).toContain("same named location");
    expect(presentation.shortReason).toContain("closely aligned timing");
    expect(presentation.explanation).toMatch(/not a claim of causation/i);
  });

  it("does not present a country-only match as an anchored connection", () => {
    const presentation = presentEventLinkage(0.72, {
      country: 1,
      temporal: 0.9,
      event_type: 1,
    });

    expect(presentation.label).toBe("Likely linked");
    expect(presentation.shortReason).toBe("72% correlation score");
    expect(presentation.explanation).not.toMatch(/same country/i);
  });

  it("distinguishes the source signal that started an investigation", () => {
    const presentation = presentEventLinkage(1, { decision: "created", temporal: 1 });
    expect(presentation.label).toBe("Starting signal");
    expect(presentation.explanation).toMatch(/started the current investigation/i);
  });

  it("labels podcast, weather, transport, and news evidence for readers", () => {
    expect(signalDomainLabel("podcast", "podcast_episode")).toBe("Podcast episode");
    expect(signalDomainLabel("weather_forecast", "openweather_forecast")).toBe("Weather signal");
    expect(signalDomainLabel("transport", "ais_vessel")).toBe("Transport signal");
    expect(signalDomainLabel("news", "item")).toBe("News report");
  });
});
