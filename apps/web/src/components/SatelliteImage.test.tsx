// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SatelliteImage from "./SatelliteImage";

afterEach(cleanup);

describe("SatelliteImage", () => {
  it("falls back from a stored asset to proxied GIBS context", () => {
    render(<SatelliteImage sources={["/api/earth-observation/assets/a", "https://gibs.earthdata.nasa.gov/example.jpg"]} alt="Event context" />);
    const image = screen.getByAltText("Event context") as HTMLImageElement;
    expect(image.src).toContain("/api/earth-observation/assets/a");
    fireEvent.error(image);
    expect((screen.getByAltText("Event context") as HTMLImageElement).src).toContain("/api/proxy-image?url=");
  });

  it("shows an actionable fallback after all sources fail", () => {
    render(<SatelliteImage sources={["/api/earth-observation/assets/a"]} alt="Event context" />);
    fireEvent.error(screen.getByAltText("Event context"));
    expect(screen.getByText("Satellite image temporarily unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry image" })).toBeTruthy();
  });
});
