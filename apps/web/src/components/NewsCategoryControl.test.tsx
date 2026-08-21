// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewsCategoryControl from "./NewsCategoryControl";
import { NEWS_CATEGORY_OPTIONS } from "./newsCategoryPresentation";

afterEach(cleanup);

describe("NewsCategoryControl", () => {
  it("exposes one keyboard- and touch-usable pressed-button group", () => {
    const onSelect = vi.fn();
    render(
      <NewsCategoryControl
        selected="markets"
        onSelect={onSelect}
        resultSummary="12 stories in markets"
      />,
    );

    const group = screen.getByRole("group", { name: "Browse by category" });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(NEWS_CATEGORY_OPTIONS.length);
    expect(screen.getByRole("button", { name: "All categories" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Markets" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Economy" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("12 stories in markets");

    fireEvent.click(screen.getByRole("button", { name: "Climate & disasters" }));
    expect(onSelect).toHaveBeenCalledWith("climate_disasters");
  });

  it("announces server refreshes, exposes facet counts, and keeps keyboard focus stable", () => {
    const props = {
      selected: "transport" as const,
      onSelect: () => undefined,
      resultSummary: "3 stories in transport",
      categoryCounts: { transport: 3, markets: 12 },
    };
    const { rerender } = render(
      <NewsCategoryControl
        {...props}
      />,
    );

    const group = screen.getByRole("group", { name: "Browse by category" });
    const transport = screen.getByRole("button", { name: /Transport.*3 stories/ }) as HTMLButtonElement;
    transport.focus();
    rerender(<NewsCategoryControl {...props} loading />);

    expect(screen.getByRole("status").textContent).toBe("Updating reporting…");
    expect(group.getAttribute("aria-busy")).toBe("true");
    expect(transport.disabled).toBe(false);
    expect(document.activeElement).toBe(transport);
    expect((screen.getByRole("button", { name: /Markets.*12 stories/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
