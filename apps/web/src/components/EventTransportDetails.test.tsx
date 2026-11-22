// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import EventSignalVisuals from "./EventSignalVisuals";
import { event } from "../test/situationFixture";
import type { IntelligenceEventDetail } from "../lib/api";
const api = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("../lib/api", () => ({ fetchEventTransport: api.transport, fetchEventWeather: vi.fn() }));
afterEach(cleanup);
it("loads port-specific movement details only after an explicit drill-down and cancels on close", async () => {
  let signal: AbortSignal | undefined;
  api.transport.mockImplementation((_id: string, input: AbortSignal) => { signal = input; return new Promise(() => {}); });
  const detail = { event, evidence: [{ id: "comparison", domain: "transport", evidence_type: "rolling_baseline_anomaly", metadata: { current: 3, baseline: 12 } }], news_images: [], context_images: [], earth_observations: [] } as unknown as IntelligenceEventDetail;
  const view = render(<EventSignalVisuals detail={detail} />);
  expect(screen.getByLabelText("Observed 3 arrivals and departures; rolling baseline 12")).toBeTruthy();
  expect(api.transport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Explore this anomaly’s movements"));
  await waitFor(() => expect(api.transport).toHaveBeenCalledWith(event.id, expect.any(AbortSignal)));
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
