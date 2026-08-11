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
    expect(screen.getByText("Imagery unavailable")).toBeTruthy();
    expect(screen.getByText("The visual asset could not be decoded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry image" })).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("style")).toContain("background-color: var(--shell-sidebar)");
    expect(screen.getByText("Imagery unavailable").parentElement?.className).toContain("max-w-64");
  });

  it("uses a compact governed placeholder when an observation has no asset", () => {
    render(<SatelliteImage sources={[]} alt="Natural color observation" fallbackClassName="flex aspect-video w-full items-center justify-center bg-white" />);
    expect(screen.getByText("No visual asset is attached to this observation.")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("style")).toContain("var(--shell-sidebar)");
    expect(screen.queryByRole("button", { name: "Retry image" })).toBeNull();
  });
});
