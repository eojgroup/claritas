// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NewsImageGallery, { NewsImageCards } from "./NewsImageGallery";
import { fetchNewsImages, type NewsImage } from "../lib/api";
vi.mock("../lib/api", () => ({ fetchNewsImages: vi.fn(),imageProxy: (url: string) => url }));
afterEach(() => { cleanup();vi.resetAllMocks(); });
const photo = { id: "photo",item_id: 1,content_hash: "hash",preview_url: "/api/news-images/photo/preview",image_url: "https://publisher.example/image.jpg",publisher: "Publisher",article_title: "Port report",article_url: "https://publisher.example/report",caption: "Port photo",license: "Publisher rights",width: 1024,height: 768,notice: "Capture time and location are unverified.",analysis: { summary: "Visible vessel",object_counts: [{ object_type: "vessel",area: "image",status: "estimated",count_min: 1,count_max: 1,confidence: .8,reason: "Clear hull",boxes: [[.1,.2,.3,.4]] }] } } as NewsImage;
it("shows cached news images with publisher provenance and optional detection overlays", () => {
  const { container } = render(<NewsImageCards images={[photo]} />);
  expect(screen.getByAltText("Port photo").getAttribute("src")).toBe(photo.preview_url);
  expect(screen.getByRole("link",{ name: "Port report" }).getAttribute("href")).toBe(photo.article_url);
  expect(screen.getByText(/Capture time and location/)).toBeTruthy();
  expect(container.querySelectorAll("rect")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button",{ name: "Show detected objects" }));
  expect(container.querySelector("rect")?.getAttribute("x")).toBe("10");
});
it("clears prior scope photos while a new event image request is pending", async () => {
  vi.mocked(fetchNewsImages).mockResolvedValueOnce([photo]);
  const view = render(<NewsImageGallery eventId="event-a" />);
  await screen.findByRole("link",{ name: "Port report" });
  let resolve!: (value: NewsImage[]) => void;
  vi.mocked(fetchNewsImages).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  view.rerender(<NewsImageGallery eventId="event-b" />);
  expect(screen.queryByRole("link",{ name: "Port report" })).toBeNull();
  await waitFor(() => expect(fetchNewsImages).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: "event-b" })));
  await act(async () => resolve([]));
  expect(screen.getByText(/No retained images match/)).toBeTruthy();
});
