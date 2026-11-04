// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import HeadlineTranslation from "./HeadlineTranslation";
import { displayHeadline } from "../lib/headlineTranslation";
import type { HeadlineTranslationPresentation } from "../lib/api";

afterEach(cleanup);
const translated: HeadlineTranslationPresentation = {
  original_title: "דיווח חדש מירושלים", language_code: "he", display_language: "en",
  translated_title: "New report from Jerusalem", translation_status: "translated",
  original_summary: "מקור", summary_translation_status: "pending",
  translation: { target_language_code: "en", provider: "openrouter", summary_status: "not_requested" },
};

it("labels cached translations and keeps the publisher headline accessible with its language", () => {
  render(<HeadlineTranslation value={translated} showSummaryNotice />);
  expect(screen.getByText("AI translation")).toBeTruthy();
  expect(screen.getByText("Source excerpt in original language")).toBeTruthy();
  fireEvent.click(screen.getByText("Original headline"));
  const original = screen.getByText(translated.original_title!);
  expect(original.getAttribute("lang")).toBe("he");
  expect(original.getAttribute("dir")).toBe("auto");
  expect(original.closest("details")?.open).toBe(true);
});

it("explains a quota pause without removing the original article or claiming translation is complete", () => {
  const value: HeadlineTranslationPresentation = { translation_status: "pending", translation_availability: {
    status: "quota_limited", reason: "The shared free provider allowance is exhausted.",
  } };
  render(<HeadlineTranslation value={value} />);
  expect(screen.getByText("Translation allowance reached").getAttribute("title")).toContain("shared free provider");
  expect(screen.queryByText("AI translation")).toBeNull();
  expect(displayHeadline({ ...value, translated_title: "Unverified cache" }, "Original article")).toBe("Original article");
});

it("prefers valid cached text only for its requested display language", () => {
  expect(displayHeadline(translated, "Original article")).toBe("New report from Jerusalem");
  expect(displayHeadline({ ...translated, display_language: "fr" }, "Original article")).toBe("Original article");
  const { container } = render(<HeadlineTranslation value={{ translation_status: "not_required" }} />);
  expect(container.textContent).toBe("");
});
