import { expect, it } from "vitest";
import { MAP_EVENT_KINDS, mapEventKind } from "./mapEventPresentation";

it("gives hazards, transport and reporting distinct plain-language map identities", () => {
  expect(mapEventKind("earthquake")).toBe("earthquake");
  expect(mapEventKind("severe_storm")).toBe("storm");
  expect(mapEventKind("transport_activity_change")).toBe("transport");
  expect(mapEventKind("reported_development")).toBe("news");
  expect(MAP_EVENT_KINDS.news.label).toBe("News report");
});
