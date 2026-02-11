import { useMemo, useState } from "react";
import type { AuthProvider, AuthProviderId } from "../lib/api";
import googleIcon from "../assets/provider-icons/google.svg";
import microsoftIcon from "../assets/provider-icons/microsoft.svg";
import appleIcon from "../assets/provider-icons/apple.svg";

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

const providerIcons: Record<AuthProviderId, string> = {
  google: googleIcon,
  microsoft: microsoftIcon,
  apple: appleIcon,
};

const heroImageUrl = `${import.meta.env.BASE_URL}claritas-hero.png`;

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
  return (
    <span
      className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-black/5"
      style={{ width: 44, height: 44 }}
    >
      <img
        src={providerIcons[id]}
        alt=""
        width={20}
        height={20}
        className="h-5 w-5"
        loading="lazy"
        decoding="async"
      />
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
  const [showMethods, setShowMethods] = useState(false);

  const handleModeChange = (nextMode: "signin" | "signup") => {
    setMode(nextMode);
    if (nextMode === "signup") {
      setShowMethods(true);
    }
  };

  const enabledProviders = providerMeta.filter((meta) => enabledMap.get(meta.id));
  const primaryProvider = !isChecking && enabledProviders.length === 1 ? enabledProviders[0] : null;
  const primaryDisabled = isChecking || enabledProviders.length === 0;
  const primaryLabel = mode === "signin" ? "Continue to Claritas" : "Create Claritas account";

  const handlePrimaryAction = () => {
    if (primaryProvider) {
      onSignIn(primaryProvider.id);
      return;
    }
    setShowMethods(true);
  };

  return (
    <div className="relative min-h-screen bg-[color:var(--login-cream)] text-[color:var(--login-ink)]">

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-4 py-12 sm:px-6 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-20">
        <section className="order-2 space-y-10 lg:order-1">
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
            <div className="overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-sm">
              <div
                className="h-56 sm:h-64 bg-[color:var(--login-sand)] bg-cover bg-center"
                style={{ backgroundImage: `url(${heroImageUrl})` }}
                aria-label="Claritas environment preview"
              />
              <div className="px-4 py-3 text-sm text-slate-600">
                A unified workspace for global signals, alerts, and monitoring.
              </div>
            </div>
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
            {["SOC 2 controls", "Encrypted sessions", "Geo-aware policies", "24/7 monitoring"].map((item) => (
              <div
                key={item}
                className="rounded-full border border-white/80 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="order-1 rounded-3xl border border-white/80 bg-white/95 p-8 text-slate-900 shadow-[0_24px_60px_rgba(14,30,37,0.16)] motion-safe:animate-[login-fade_800ms_ease-out_both] lg:order-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Secure access</div>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--login-ink)]" style={{ fontFamily: "var(--font-display)" }}>
                {mode === "signin" ? "Sign in to Claritas" : "Create a Claritas account"}
              </h2>
            </div>
            <div className="rounded-full bg-[color:var(--login-ink)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--login-cream)]">
              {isChecking ? "Checking" : primaryDisabled ? "Unavailable" : "Ready"}
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

          <div className="mt-6 space-y-4">
            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {mode === "signin"
                ? "Use your trusted identity provider to access the Claritas signal desk."
                : "Create your Claritas account using the provider you already trust."}
            </div>

            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={primaryDisabled}
              className={`w-full rounded-2xl px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
                primaryDisabled
                  ? "cursor-not-allowed bg-slate-200 text-slate-500"
                  : "bg-slate-900 text-white hover:bg-slate-800"
              }`}
            >
              {primaryLabel}
            </button>

            {enabledProviders.length === 0 && !isChecking && (
              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-xs text-slate-500">
                No providers are enabled yet. Configure an identity provider to continue.
              </div>
            )}

            {enabledProviders.length > 1 && (
              <button
                type="button"
                onClick={() => setShowMethods((v) => !v)}
                className="text-sm font-semibold text-[color:var(--login-teal)]"
              >
                {showMethods ? "Hide other methods" : "Other methods"}
              </button>
            )}

            {showMethods && (
              <div className="space-y-3">
                {providerMeta.map((meta) => (
                  <ProviderButton
                    key={meta.id}
                    id={meta.id}
                    label={mode === "signin" ? meta.label : meta.signupLabel}
                    helper={meta.helper}
                    enabled={enabledMap.get(meta.id) ?? false}
                    busy={isChecking}
                    onClick={() => onSignIn(meta.id)}
                  />
                ))}
              </div>
            )}

            {mode === "signin" ? (
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
            ) : (
              <>
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
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
