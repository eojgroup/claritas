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

  it("discloses the governed unique-country earthquake fallback", () => {
    const rationale = "Included as contextual news evidence because it was the only major same-family event in the country and time window. This association does not establish causation.";
    const presentation = presentEventLinkage(0.46, {
      decision: "attached",
      country: 1,
      temporal: 0.9,
      event_type: 1,
      unique_country_candidate: true,
      rationale,
    });

    expect(presentation.shortReason).toContain("only major same-family event");
    expect(presentation.explanation).toBe(rationale);
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
