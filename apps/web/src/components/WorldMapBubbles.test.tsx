// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorldMapBubbles from "./WorldMapBubbles";

vi.mock("world-countries", () => ({
  default: [
    { cca2: "DE", ccn3: "276", latlng: [51, 10], name: { common: "Germany" } },
    { cca2: "BR", ccn3: "076", latlng: [-10, -55], name: { common: "Brazil" } },
  ],
}));

vi.mock("world-atlas/countries-110m.json", () => ({
  default: {
    type: "Topology",
    arcs: [],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Point", id: "276", coordinates: [10, 51], properties: {} },
          { type: "Point", id: "076", coordinates: [-55, -10], properties: {} },
        ],
      },
      land: { type: "GeometryCollection", geometries: [] },
    },
  },
}));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

class PointerEventMock extends MouseEvent {
  pointerId: number;
  pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const rect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 960,
  bottom: 480,
  width: 960,
  height: 480,
  toJSON: () => ({}),
};

function renderMap() {
  const onSelect = vi.fn();
  const onSelectPoint = vi.fn();
  render(
    <div style={{ width: 960, height: 480 }}>
      <WorldMapBubbles
        data={[
          { country: "DE", count: 8, tone: "signal" },
          { country: "BR", count: 5, tone: "signal" },
        ]}
        points={[{
          id: "event-1",
          latitude: -15.7,
          longitude: -47.9,
          title: "Observed fire signal",
          severity: "high",
        }]}
        onSelect={onSelect}
        onSelectPoint={onSelectPoint}
      />
    </div>,
  );
  const svg = screen.getByRole("application") as unknown as SVGSVGElement;
  Object.defineProperty(svg, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  const mapLayer = svg.querySelector("g[transform]");
  if (!mapLayer) throw new Error("Expected rendered map layer");
  return { mapLayer, onSelect, onSelectPoint, svg };
}


function dispatchWheel(
  target: Element,
  init: WheelEventInit,
) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 480,
    clientY: 240,
    ...init,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

function dispatchTouchMove(target: Element, touchCount: number) {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    configurable: true,
    value: Array.from({ length: touchCount }, (_, identifier) => ({ identifier })),
  });
  act(() => target.dispatchEvent(event));
  return event;
}

describe("WorldMapBubbles interaction", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("PointerEvent", PointerEventMock);
  });
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    vi.unstubAllGlobals();
  });
  it("follows theme changes when embedded without an explicit theme and honours an explicit override", async () => {
    const view = render(<WorldMapBubbles data={[]} />);
    const ocean = () => view.container.querySelector("svg > rect")?.getAttribute("fill");
    const light = ocean();
    await act(async () => { document.documentElement.classList.add("dark"); });
    expect(ocean()).not.toBe(light);
    view.rerender(<WorldMapBubbles data={[]} dark={false} />);
    expect(ocean()).toBe(light);
  });
  it("opens a larger location-linked photo preview without navigating away until the story is requested",()=>{
    const select=vi.fn(),point={id:"image-story",latitude:26.56,longitude:56.25,title:"Port activity reported",locationLabel:"Strait of Hormuz",imageUrl:"/api/news-images/photo/preview",imageCapturedAt:"2026-11-23T08:00:00Z",imageAttribution:"Source newsroom",hasImagery:true};
    const {container}=render(<WorldMapBubbles data={[]} points={[point]} onSelectPoint={select}/>);
    const map=container.querySelector('svg');
    fireEvent.click(screen.getByRole("button",{name:"Preview image: Port activity reported"}));
    const preview=screen.getByRole("dialog",{name:"Map image preview"});
    expect(screen.getByRole("button",{name:"Preview image: Port activity reported"}).getAttribute("aria-expanded")).toBe("true");
    expect(within(preview).getByRole("img",{name:point.title})).toBeTruthy();
    expect(within(preview).getByText("Strait of Hormuz")).toBeTruthy();
    expect(within(preview).getByText("Source newsroom")).toBeTruthy();expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(preview,{key:"Escape"});expect(screen.queryByRole("dialog")).toBeNull();expect(container.querySelector('svg')).toBe(map);
    fireEvent.keyDown(screen.getByRole("button",{name:"Preview image: Port activity reported"}),{key:"Enter"});
    fireEvent.click(screen.getByRole("button",{name:"Open event & imagery ↗"}));expect(select).toHaveBeenCalledWith(expect.objectContaining({id:point.id}));
  });
  it("hides an unavailable image while keeping its event selectable", () => {
    const select = vi.fn();
    const { container } = render(<WorldMapBubbles data={[]} onSelectPoint={select} points={[{
      id: "photo-event", latitude: 26.56, longitude: 56.25, title: "Located report", kind: "news",
      imageUrl: "/api/news-images/unavailable/preview", hasImagery: true,
    }]} />);
    const photo = container.querySelector("image");
    expect(photo).toBeTruthy();
    fireEvent.error(photo!);
    expect(container.querySelector("image")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Located report/ }));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "photo-event" }));
  });

it("keeps the event key visible without opening a disclosure", () => {
  renderMap();
  expect(screen.getByLabelText("Map event types").textContent).toContain("News report");
  expect(screen.getByLabelText("Reported severity").textContent).toContain("critical");
  expect(screen.queryByText("How to read the map")).toBeNull();
});

  it("renders and remains interactive when the event layer is omitted", () => {
    // News, weather and market maps provide countries only. This path used to
    // repeatedly refit a fresh default points array until React locked up.
    const onSelect = vi.fn();
    render(<WorldMapBubbles data={[
      { country: "DE", count: 8 },
      { country: "BR", count: 5 },
    ]} onSelect={onSelect} />);
    expect(screen.getByRole("application").getAttribute("viewBox")).toBe("0 0 960 480");
    fireEvent.click(screen.getAllByRole("button", { name: /Germany: 8/i })[0]);
    expect(onSelect).toHaveBeenCalledWith("DE");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("application").querySelector("g[transform]")?.getAttribute("transform"))
      .not.toContain("NaN");
  });

  it("preserves the map viewport when an event is selected or country counts refresh", () => {
    const data = [{ country: "DE", count: 8 }, { country: "BR", count: 5 }];
    const points = [{ id: "event-1", latitude: -15.7, longitude: -47.9, title: "Fire" }];
    const { rerender } = render(<WorldMapBubbles data={data} points={points} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const viewport = () => screen.getByRole("application").querySelector("g[transform]")?.getAttribute("transform");
    const zoomed = viewport();
    rerender(<WorldMapBubbles
      data={[{ country: "DE", count: 9 }, { country: "BR", count: 10 }]}
      points={[{ ...points[0], selected: true }]}
    />);
    expect(viewport()).toBe(zoomed);
  });

  it("centers standalone event maps on their precise point instead of the country reference", () => {
    render(<WorldMapBubbles data={[{ country: "BR", count: 1 }]} primaryCountry="BR" focusOnActivity
      focusCoordinate={[-47.9, -15.7]} points={[{ id: "event", latitude: -15.7, longitude: -47.9, title: "Event location" }]} />);
    const mapLayer = screen.getByRole("application").querySelector("g[transform]")!;
    const camera = mapLayer.getAttribute("transform")!.match(/translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)/)!;
    const pin = screen.getByRole("button", { name: /Event location/ }).getAttribute("transform")!.match(/translate\(([^ ]+) ([^)]+)\)/)!;
    expect(Number(camera[1]) + Number(pin[1]) * Number(camera[3])).toBeCloseTo(480);
    expect(Number(camera[2]) + Number(pin[2]) * Number(camera[3])).toBeCloseTo(240);
  });

  it("starts around the activity leader and preserves the camera on background updates", () => {
    const view = render(<WorldMapBubbles data={[{ country: "DE", count: 100 }, { country: "BR", count: 20 }]}
      focusOnActivity featuredCountry="DE" />);
    const viewport = () => screen.getByRole("application").querySelector("g[transform]")?.getAttribute("transform");
    const focused = viewport();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = viewport();
    expect(zoomed).not.toBe(focused);
    view.rerender(<WorldMapBubbles data={[{ country: "DE", count: 104 }, { country: "BR", count: 24 }]}
      focusOnActivity featuredCountry="DE" />);
    expect(viewport()).toBe(zoomed);
    view.rerender(<WorldMapBubbles data={[{ country: "DE", count: 104 }, { country: "BR", count: 24 }]}
      focusOnActivity featuredCountry="DE" primaryCountry="BR" />);
    expect(viewport()).not.toBe(zoomed);
  });

  it("keeps ordinary wheel scrolling inert on hover until the map is activated", () => {
    const { mapLayer, svg } = renderMap();
    const eventMarker = screen.getByRole("button", { name: /Observed fire signal/i });
    const beforeHover = mapLayer.getAttribute("transform");
    fireEvent.pointerEnter(eventMarker, { clientX: 420, clientY: 260 });
    const tooltip = screen.getByText("Observed fire signal").closest(".map-event-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.classList.contains("app-card")).toBe(false);
    expect((tooltip as HTMLElement).style.position).toBe("absolute");
    expect(mapLayer.getAttribute("transform")).toBe(beforeHover);
    const before = mapLayer.getAttribute("transform");

    const hoverWheel = dispatchWheel(svg, { deltaY: -100 });

    expect(hoverWheel.defaultPrevented).toBe(false);
    expect(mapLayer.getAttribute("transform")).toBe(before);

    fireEvent.pointerDown(svg, {
      button: 0,
      clientX: 480,
      clientY: 240,
      pointerId: 7,
      pointerType: "mouse",
    });
    const activatedWheel = dispatchWheel(svg, { deltaY: -100 });

    expect(activatedWheel.defaultPrevented).toBe(true);
    expect(mapLayer.getAttribute("transform")).not.toBe(before);
  });

  it("returns same-direction wheel scrolling to the page at the minimum zoom", () => {
    const { mapLayer, svg } = renderMap();
    fireEvent.pointerDown(svg, {
      button: 0,
      clientX: 480,
      clientY: 240,
      pointerId: 8,
      pointerType: "mouse",
    });
    const before = mapLayer.getAttribute("transform");

    const event = dispatchWheel(svg, { deltaY: 100 });

    expect(event.defaultPrevented).toBe(false);
    expect(mapLayer.getAttribute("transform")).toBe(before);
  });

  it("zooms a trackpad pinch immediately with a cancellable native wheel", () => {
    const { mapLayer, svg } = renderMap();
    const before = mapLayer.getAttribute("transform");

    const event = dispatchWheel(svg, { ctrlKey: true, deltaY: -20 });

    expect(event.defaultPrevented).toBe(true);
    expect(mapLayer.getAttribute("transform")).not.toBe(before);
  });

  it("keeps modifier-assisted wheel zoom available for keyboard-focused users", () => {
    const { mapLayer, svg } = renderMap();
    act(() => svg.focus());
    expect(document.activeElement).toBe(svg);
    const before = mapLayer.getAttribute("transform");

    const event = dispatchWheel(svg, { ctrlKey: true, deltaY: -100 });

    expect(event.defaultPrevented).toBe(true);
    expect(mapLayer.getAttribute("transform")).not.toBe(before);
  });

  it("arms wheel zoom from a country pointer action without interfering with selection", () => {
    const { mapLayer, svg } = renderMap();
    const country = screen.getAllByRole("button", { name: /Germany: 8/i })[0];
    fireEvent.pointerDown(country, {
      button: 0,
      clientX: 500,
      clientY: 180,
      pointerId: 1,
      pointerType: "mouse",
    });
    const before = mapLayer.getAttribute("transform");

    const event = dispatchWheel(svg, { deltaY: -100 });

    expect(event.defaultPrevented).toBe(true);
    expect(mapLayer.getAttribute("transform")).not.toBe(before);
  });

  it("supports two-pointer touch pinch without selecting a marker", () => {
    const { mapLayer, onSelect, onSelectPoint, svg } = renderMap();
    const setPointerCapture = vi.fn();
    Object.defineProperties(svg, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    const before = mapLayer.getAttribute("transform");
    fireEvent.pointerDown(svg, {
      button: 0,
      clientX: 400,
      clientY: 240,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerDown(svg, {
      button: 0,
      clientX: 500,
      clientY: 240,
      pointerId: 2,
      pointerType: "touch",
    });
    fireEvent.pointerMove(svg, {
      clientX: 600,
      clientY: 240,
      pointerId: 2,
      pointerType: "touch",
    });
    const touchMove = dispatchTouchMove(svg, 2);

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(setPointerCapture).toHaveBeenCalledWith(2);
    expect(mapLayer.getAttribute("transform")).not.toBe(before);
    expect(touchMove.defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSelectPoint).not.toHaveBeenCalled();
  });

  it("lets a single finger pan the immersive canvas and suppresses the resulting synthetic click", () => {
    const onSelectPoint = vi.fn();
    render(<WorldMapBubbles data={[]} allowsSingleFingerPan points={[{ id: "event", latitude: 0, longitude: 0, title: "Event location" }]} onSelectPoint={onSelectPoint} />);
    const svg = screen.getByRole("application");
    const layer = svg.querySelector("g[transform]")!;
    const before = layer.getAttribute("transform");
    const marker = screen.getByRole("button", { name: /Event location/ });
    Object.defineProperty(svg, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: "touch", button: 0, clientX: 450, clientY: 180 });
    fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "touch", clientX: 450, clientY: 300 });
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: "touch", clientX: 450, clientY: 300 });
    fireEvent.click(marker);
    expect(svg.style.touchAction).toBe("none");
    expect(layer.getAttribute("transform")).not.toBe(before);
    expect(onSelectPoint).not.toHaveBeenCalled();
  });

  it("leaves one-finger vertical movement to native page scrolling", () => {
    const { mapLayer, svg } = renderMap();
    const setPointerCapture = vi.fn();
    Object.defineProperty(svg, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    const before = mapLayer.getAttribute("transform");

    fireEvent.pointerDown(svg, {
      button: 0,
      clientX: 450,
      clientY: 180,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(svg, {
      clientX: 450,
      clientY: 300,
      pointerId: 1,
      pointerType: "touch",
    });
    const touchMove = dispatchTouchMove(svg, 1);

    expect(svg.style.touchAction).toBe("pan-y");
    expect(touchMove.defaultPrevented).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(mapLayer.getAttribute("transform")).toBe(before);
  });

  it("suppresses a delayed synthetic click after dragging, then restores selection", () => {
    vi.useFakeTimers();
    try {
      const { onSelectPoint, svg } = renderMap();
      Object.defineProperties(svg, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        hasPointerCapture: { configurable: true, value: () => true },
        releasePointerCapture: { configurable: true, value: vi.fn() },
      });
      const marker = screen.getByRole("button", { name: /Observed fire signal/i });
      fireEvent.pointerDown(marker, {
        button: 0,
        clientX: 400,
        clientY: 240,
        pointerId: 3,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(svg, {
        clientX: 440,
        clientY: 270,
        pointerId: 3,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(svg, {
        clientX: 440,
        clientY: 270,
        pointerId: 3,
        pointerType: "mouse",
      });

      act(() => vi.advanceTimersByTime(250));
      fireEvent.click(marker);
      expect(onSelectPoint).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(700));
      fireEvent.click(marker);
      expect(onSelectPoint).toHaveBeenCalledWith(
        expect.objectContaining({ id: "event-1" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps country and event markers directly selectable", () => {
    const { onSelect, onSelectPoint } = renderMap();
    fireEvent.click(screen.getAllByRole("button", { name: /Germany: 8/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Observed fire signal/i }));
    expect(onSelect).toHaveBeenCalledWith("DE");
    expect(onSelectPoint).toHaveBeenCalledWith(
      expect.objectContaining({ id: "event-1" }),
    );
  });
});

it("keeps equally weighted and weak linked countries visibly shaded in transport heatmaps", () => {
  const view = render(<WorldMapBubbles data={[{country:"DE",count:7}]} fillMode="relevance" scale="log" dark />);
  const linked = screen.getAllByRole("button",{name:"Germany: 7"}).find(node=>node.tagName.toLowerCase()==="path")!.getAttribute("fill");
  const unlinked = screen.getByRole("button",{name:"Brazil: no mapped signal"}).getAttribute("fill");
  expect(linked).not.toBe(unlinked);
  expect(linked).toBe("rgb(213,126,70)");
  view.rerender(<WorldMapBubbles data={[{country:"DE",count:10000},{country:"BR",count:1}]} fillMode="relevance" scale="log" dark />);
  expect(screen.getAllByRole("button",{name:"Brazil: 1"}).find(node=>node.tagName.toLowerCase()==="path")!.getAttribute("fill")).not.toBe(unlinked);
});
