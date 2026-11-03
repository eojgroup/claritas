// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider } from "../lib/api";
import LoginPage from "./LoginPage";

const providers: AuthProvider[] = [
  { id: "google", enabled: true, start_path: "/api/auth/google/start" },
  { id: "microsoft", enabled: true, start_path: "/api/auth/microsoft/start" },
  { id: "apple", enabled: false, start_path: "/api/auth/apple/start" },
];

afterEach(cleanup);

describe("LoginPage", () => {
  it("keeps provider discovery visibly pending when there is no existing session", () => {
    render(<LoginPage providers={[]} providersLoading status="unauthed" onSignIn={vi.fn()} />);
    expect(screen.getByText("Connecting to your workspace…")).toBeTruthy();
    expect(screen.queryByText(/No sign-in providers/)).toBeNull();
  });
  it("presents the intelligence workspace and only configured identity providers", () => {
    render(<LoginPage providers={providers} status="unauthed" onSignIn={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /Enter your workspace/i })).toBeTruthy();
    expect(screen.getByText(/map-led operating picture/i)).toBeTruthy();
    expect(screen.getByAltText(/satellite and map view/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue with Microsoft/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue with Apple/i })).toBeNull();
  });

  it("starts the selected provider and exposes failures as an alert", () => {
    const onSignIn = vi.fn();
    const onRetry = vi.fn();
    render(
      <LoginPage
        providers={providers}
        status="unauthed"
        error="Identity service is unavailable"
        onSignIn={onSignIn}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Continue with Microsoft/i }));
    expect(onSignIn).toHaveBeenCalledWith("microsoft");
    expect(screen.getByRole("alert").textContent).toContain("Identity service is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
