// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModalSurface from "./ModalSurface";

afterEach(cleanup);

function Workspace() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open reporting search</button>
    <button>Background control</button>
    {open && <ModalSurface label="Reporting search" onClose={() => setOpen(false)} className="backdrop" surfaceClassName="surface">
      <input aria-label="Search reporting" />
      <button disabled>Unavailable action</button>
      <button onClick={() => setOpen(false)}>Close search</button>
    </ModalSurface>}
  </>;
}

describe("workspace modal keyboard access", () => {
  it("contains focus, disables the background, closes with Escape and restores focus and scrolling", () => {
    const { container } = render(<Workspace />);
    const trigger = screen.getByRole("button", { name: "Open reporting search" });
    trigger.focus();
    document.body.style.overflow = "auto";
    fireEvent.click(trigger);
    const input = screen.getByRole("textbox", { name: "Search reporting" });
    const close = screen.getByRole("button", { name: "Close search" });
    expect(document.activeElement).toBe(input);
    expect(container.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    screen.getByRole("button", { name: "Background control" }).focus();
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.inert).not.toBe(true);
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("closes only for a backdrop click and supports a dialog without interactive children", () => {
    const onClose = vi.fn();
    render(<ModalSurface label="Empty result" onClose={onClose} className="backdrop" surfaceClassName="surface"><p>No reporting found</p></ModalSurface>);
    const dialog = screen.getByRole("dialog", { name: "Empty result" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.click(screen.getByText("No reporting found"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses the latest close callback without moving focus on a content update", () => {
    const firstClose = vi.fn();
    const nextClose = vi.fn();
    const props = { label: "Search", className: "backdrop", surfaceClassName: "surface" };
    const { rerender } = render(<ModalSurface {...props} onClose={firstClose}><input aria-label="Query" /><button>Source</button></ModalSurface>);
    const source = screen.getByRole("button", { name: "Source" });
    source.focus();
    rerender(<ModalSurface {...props} onClose={nextClose}><input aria-label="Query" /><button>Source</button></ModalSurface>);
    expect(document.activeElement).toBe(source);
    fireEvent.keyDown(source, { key: "Escape" });
    expect(firstClose).not.toHaveBeenCalled();
    expect(nextClose).toHaveBeenCalledOnce();
  });
});
