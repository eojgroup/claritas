import { useMemo, useState } from "react";
import type { AuthProvider, AuthProviderId } from "../lib/api";

type LoginPageProps = {
  providers: AuthProvider[];
  status: "checking" | "unauthed";
  error?: string | null;
  onSignIn: (provider: AuthProviderId) => void;
};

type ProviderMeta = {
  id: AuthProviderId;
  label: string;
  signupLabel: string;
  helper: string;
};

const providerMeta: ProviderMeta[] = [
  {
    id: "google",
    label: "Continue with Google",
    signupLabel: "Sign up with Google",
    helper: "Personal or Workspace accounts",
  },
  {
    id: "microsoft",
    label: "Continue with Microsoft",
    signupLabel: "Sign up with Microsoft",
    helper: "Azure AD or Microsoft 365",
  },
  {
    id: "apple",
    label: "Continue with Apple",
    signupLabel: "Sign up with Apple",
    helper: "Apple ID for iOS and macOS",
  },
];

const highlightCards = [
  {
    title: "Signal desk access",
    description: "Monitor global events, weather, and alerts with one secure sign-in.",
  },
  {
    title: "Session-first security",
    description: "Short-lived sessions with explicit scopes and tight redirect control.",
  },
  {
    title: "Provider neutrality",
    description: "Use the identity provider you already trust. No new passwords.",
  },
  {
    title: "Audit-ready detail",
    description: "Traceable access and revocation with every login event captured.",
  },
];


function ProviderIcon({ id }: { id: AuthProviderId }) {
  if (id === "google") {
    return (
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-black/5">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
          <path
            fill="#4285F4"
            d="M21.35 11.1H12v2.9h5.34c-.48 2.4-2.44 3.5-5.34 3.5-3.24 0-5.87-2.63-5.87-5.87S8.76 5.76 12 5.76c1.78 0 3.26.73 4.3 1.7l1.96-1.96C16.97 3.98 14.67 2.85 12 2.85 7.82 2.85 4.3 6.37 4.3 10.55S7.82 18.25 12 18.25c4.77 0 7.6-3.35 7.6-8.05 0-.54-.06-1.07-.17-1.59z"
          />
        </svg>
      </span>
    );
  }
  if (id === "microsoft") {
    return (
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-black/5">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
          <rect x="3" y="3" width="8" height="8" fill="#F25022" />
          <rect x="13" y="3" width="8" height="8" fill="#7FBA00" />
          <rect x="3" y="13" width="8" height="8" fill="#00A4EF" />
          <rect x="13" y="13" width="8" height="8" fill="#FFB900" />
        </svg>
      </span>
    );
  }

  return (
    <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#0f1113] text-white shadow-sm ring-1 ring-black/10">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
        <path d="M16.365 1.43c0 1.14-.403 2.076-1.222 2.818-.986.897-2.161 1.42-3.466 1.308-.153-1.106.45-2.22 1.322-2.93.96-.783 2.39-1.36 3.366-1.196zm4.073 14.215c-.753 1.726-1.64 3.439-3.048 3.47-1.32.03-1.742-.87-3.247-.87-1.503 0-1.978.84-3.228.9-1.38.06-2.446-1.41-3.206-3.12-1.66-3.74-2.9-10.56.52-13.32 1.06-.86 2.36-1.39 3.77-1.42 1.32-.03 2.57.93 3.246.93.68 0 2.2-1.14 3.71-.97.63.03 2.41.26 3.55 1.97-.09.06-2.12 1.23-2.1 3.68.03 2.93 2.56 3.9 2.6 3.92z" />
      </svg>
    </span>
  );
}

function ProviderButton({
  id,
  label,
  helper,
  enabled,
  busy,
  onClick,
}: {
  id: AuthProviderId;
  label: string;
  helper: string;
  enabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const canUse = enabled && !busy;
  const badgeLabel = busy ? "Checking" : enabled ? "Ready" : "Disabled";
  const badgeClass = busy
    ? "bg-slate-200 text-slate-600"
    : enabled
      ? "bg-emerald-100 text-emerald-700"
      : "bg-slate-200 text-slate-500";

  return (
    <button
      type="button"
      onClick={canUse ? onClick : undefined}
      disabled={!canUse}
      className={`group flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
        canUse
          ? "border-slate-200/70 bg-white shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
          : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={canUse ? "" : "opacity-60"}>
          <ProviderIcon id={id} />
        </div>
        <div>
          <div className={`text-sm font-semibold ${canUse ? "text-slate-900" : "text-slate-400"}`}>{label}</div>
          <div className={`text-xs ${canUse ? "text-slate-500" : "text-slate-400"}`}>{helper}</div>
        </div>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeClass}`}>{badgeLabel}</span>
    </button>
  );
}

export default function LoginPage({ providers, status, error, onSignIn }: LoginPageProps) {
  const enabledMap = useMemo(() => new Map(providers.map((p) => [p.id, p.enabled])), [providers]);
  const isChecking = status === "checking";

  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const handleModeChange = (nextMode: "signin" | "signup") => {
    setMode(nextMode);
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[color:var(--login-cream)] text-[color:var(--login-ink)]">
      <div className="absolute inset-0 bg-[radial-gradient(800px_circle_at_12%_20%,rgba(31,107,104,0.18),transparent_65%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(700px_circle_at_90%_10%,rgba(211,160,107,0.18),transparent_60%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,41,51,0.08)_0%,rgba(255,255,255,0)_45%)]" />
      <div className="absolute -top-24 right-8 h-64 w-64 rounded-full bg-[color:var(--login-mist)] opacity-70 blur-3xl motion-safe:animate-[login-float_18s_ease-in-out_infinite]" />
      <div
        className="absolute -bottom-40 left-6 h-80 w-80 rounded-full bg-[color:var(--login-sand)] opacity-80 blur-3xl motion-safe:animate-[login-float_22s_ease-in-out_infinite]"
        style={{ animationDelay: "1.5s" }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-20">
        <div className="order-2 space-y-10 lg:order-1">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12">
              <div className="absolute -left-3 top-0 h-12 w-12 rounded-full bg-[#102739]" />
              <div className="absolute left-1 top-0 h-12 w-12 rounded-full bg-[#1F3C52] opacity-90" />
              <div className="absolute left-5 top-0 h-12 w-12 rounded-full bg-[#2D556F] opacity-80" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.35em] text-[color:var(--login-ink-soft)]">Claritas</div>
              <div className="text-sm text-slate-600">Secure access gateway</div>
            </div>
          </div>

          <div className="space-y-4">
            <h1
              className="text-4xl font-semibold tracking-tight text-[color:var(--login-ink)] md:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Global clarity starts with trusted identity.
            </h1>
            <p className="max-w-xl text-lg text-slate-600">
              Sign in with your provider to unlock the Claritas signal desk. No passwords stored, no extra
              identity sprawl.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {highlightCards.map((feature, index) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-white/70 bg-white/70 p-4 text-slate-700 shadow-sm backdrop-blur motion-safe:animate-[login-fade_900ms_ease-out_both]"
                style={{ animationDelay: `${index * 120}ms` }}
              >
                <div className="text-sm font-semibold text-[color:var(--login-ink)]">{feature.title}</div>
                <p className="mt-2 text-sm text-slate-600">{feature.description}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            {[
              "SOC 2 controls",
              "Encrypted sessions",
              "Geo-aware policies",
              "24/7 monitoring",
            ].map((item) => (
              <div
                key={item}
                className="rounded-full border border-white/80 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="order-1 rounded-3xl border border-white/80 bg-white/90 p-8 text-slate-900 shadow-[0_30px_80px_rgba(14,30,37,0.18)] motion-safe:animate-[login-fade_800ms_ease-out_both] lg:order-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Secure access</div>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--login-ink)]" style={{ fontFamily: "var(--font-display)" }}>
                {mode === "signin" ? "Sign in to Claritas" : "Create a Claritas account"}
              </h2>
            </div>
            <div className="rounded-full bg-[color:var(--login-ink)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--login-cream)]">
              {isChecking ? "Checking" : "Ready"}
            </div>
          </div>

          <div className="mt-6 flex w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-100 p-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            <button
              type="button"
              onClick={() => handleModeChange("signin")}
              className={`flex-1 rounded-full px-4 py-2 text-center transition ${
                mode === "signin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("signup")}
              className={`flex-1 rounded-full px-4 py-2 text-center transition ${
                mode === "signup" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Create account
            </button>
          </div>

          {mode === "signin" ? (
            <div className="mt-6 space-y-4">
              {error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {providerMeta.map((meta) => (
                <ProviderButton
                  key={meta.id}
                  id={meta.id}
                  label={meta.label}
                  helper={meta.helper}
                  enabled={enabledMap.get(meta.id) ?? false}
                  busy={isChecking}
                  onClick={() => onSignIn(meta.id)}
                />
              ))}

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {isChecking
                  ? "Checking for active sessions and configured providers."
                  : "Select a provider to continue. You will be redirected to complete sign-in."}
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">No account yet?</div>
                <div className="text-xs text-slate-500">Create your account in seconds with a provider.</div>
                <button
                  type="button"
                  onClick={() => handleModeChange("signup")}
                  className="mt-3 w-full rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-slate-800"
                >
                  Create account
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Create your Claritas account using the provider you already trust. We create your profile
                after provider verification.
              </div>

              {providerMeta.map((meta) => (
                <ProviderButton
                  key={meta.id}
                  id={meta.id}
                  label={meta.signupLabel}
                  helper={meta.helper}
                  enabled={enabledMap.get(meta.id) ?? false}
                  busy={isChecking}
                  onClick={() => onSignIn(meta.id)}
                />
              ))}

              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-xs text-slate-500">
                No passwords stored. Your identity stays with your provider.
              </div>

              <button
                type="button"
                onClick={() => handleModeChange("signin")}
                className="text-sm font-semibold text-[color:var(--login-teal)]"
              >
                Already have access? Sign in.
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
