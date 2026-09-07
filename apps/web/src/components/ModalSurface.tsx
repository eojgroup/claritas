import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  onClose: () => void;
  className: string;
  surfaceClassName: string;
  children: ReactNode;
  id?: string;
};

const focusableSelector = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** A shared keyboard and screen-reader boundary for workspace overlays. */
export default function ModalSurface({
  label,
  onClose,
  className,
  surfaceClassName,
  children,
  id,
}: Props) {
  const portalRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const portal = portalRef.current;
    if (!surface || !portal) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== portal)
      .map((element) => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = "hidden";

    const focusable = () => Array.from(surface.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.tabIndex >= 0
        && !element.closest('[hidden], [inert], [aria-hidden="true"]')
        && window.getComputedStyle(element).display !== "none"
        && window.getComputedStyle(element).visibility !== "hidden");
    const focusFirst = () => (focusable()[0] ?? surface).focus({ preventScroll: true });
    focusFirst();

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const targets = focusable();
        const first = targets[0] ?? surface;
        const last = targets[targets.length - 1] ?? surface;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === surface)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === surface)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !surface.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", handleKeyboard);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", handleKeyboard);
      document.removeEventListener("focusin", containFocus);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div ref={portalRef} className={`app-overlay text-[color:var(--shell-ink)] ${className}`} onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={surfaceRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={surfaceClassName}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}
