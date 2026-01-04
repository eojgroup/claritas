import type { AuthProvider, AuthProviderId } from "../lib/api";

type LoginPageProps = {
  providers: AuthProvider[];
  status: "checking" | "unauthed";
  error?: string | null;
  onSignIn: (provider: AuthProviderId) => void;
  signUpUrl?: string | null;
};

type ProviderMeta = {
  id: AuthProviderId;
  label: string;
  helper: string;
};

const providerMeta: ProviderMeta[] = [
  { id: "google", label: "Continue with Google", helper: "Personal or Workspace accounts" },
  { id: "microsoft", label: "Continue with Microsoft", helper: "Azure AD or Microsoft 365" },
  { id: "apple", label: "Continue with Apple", helper: "Apple ID for iOS and macOS" },
];

const featureList = [
  {
    title: "Signal-driven intelligence",
    description: "Stream global events, weather, and alerts in one secure view.",
  },
  {
    title: "Session-first security",
    description: "Short-lived sessions with explicit scopes and strict redirects.",
  },
  {
    title: "Provider neutrality",
    description: "Your identity, your provider. No new passwords to manage.",
  },
];

function ProviderIcon({ id }: { id: AuthProviderId }) {
  if (id === "google") {
    return (
      <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white shadow-sm">
        <span className="h-5 w-5 rounded-full bg-[conic-gradient(from_90deg,#4285F4_0deg_90deg,#34A853_90deg_180deg,#FBBC05_180deg_270deg,#EA4335_270deg_360deg)]" />
      </span>
    );
  }
  if (id === "microsoft") {
    return (
      <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white shadow-sm">
        <span className="grid h-5 w-5 grid-cols-2 gap-0.5">
          <span className="bg-[#F25022]" />
          <span className="bg-[#7FBA00]" />
          <span className="bg-[#00A4EF]" />
          <span className="bg-[#FFB900]" />
        </span>
      </span>
    );
  }
  return (
    <span className="grid h-9 w-9 place-items-center rounded-full bg-black text-xs font-semibold uppercase text-white shadow-sm">
      A
    </span>
  );
}

function ProviderButton({
  meta,
  enabled,
  busy,
  onClick,
}: {
  meta: ProviderMeta;
  enabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const canUse = enabled && !busy;
  return (
    <button
      type="button"
      onClick={canUse ? onClick : undefined}
      disabled={!canUse}
      className={`group flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
        canUse
          ? "border-slate-200 bg-white shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
          : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
      }`}
    >
      <div className="flex items-center gap-3">
        <ProviderIcon id={meta.id} />
        <div>
          <div className="text-sm font-semibold text-slate-900">{meta.label}</div>
          <div className="text-xs text-slate-500">{meta.helper}</div>
        </div>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
        }`}
      >
        {enabled ? "Ready" : "Disabled"}
      </span>
    </button>
  );
}

export default function LoginPage({ providers, status, error, onSignIn, signUpUrl }: LoginPageProps) {
  const enabledMap = new Map(providers.map((p) => [p.id, p.enabled]));
  const isChecking = status === "checking";
  const signUpHref = signUpUrl?.trim();
  const canSignUp = Boolean(signUpHref);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b1218] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_15%_10%,rgba(46,110,120,0.35),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_85%_85%,rgba(177,114,60,0.28),transparent_55%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.0)_40%)]" />
      <div className="absolute -top-40 right-4 h-80 w-80 rounded-full bg-[#183443] opacity-80 blur-3xl motion-safe:animate-[login-float_18s_ease-in-out_infinite]" />
      <div
        className="absolute -bottom-48 left-6 h-96 w-96 rounded-full bg-[#3b2f1b] opacity-70 blur-3xl motion-safe:animate-[login-float_22s_ease-in-out_infinite]"
        style={{ animationDelay: "1.5s" }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-16 lg:grid lg:grid-cols-[1.2fr_0.8fr] lg:py-20">
        <div className="space-y-10">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12">
              <div className="absolute -left-3 top-0 h-12 w-12 rounded-full bg-[#102739]" />
              <div className="absolute left-1 top-0 h-12 w-12 rounded-full bg-[#1F3C52] opacity-90" />
              <div className="absolute left-5 top-0 h-12 w-12 rounded-full bg-[#2D556F] opacity-80" />
            </div>
            <span className="text-sm uppercase tracking-[0.3em] text-slate-300">Claritas</span>
          </div>

          <div className="space-y-4">
            <h1
              className="text-4xl font-semibold tracking-tight text-[#f5efe6] md:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Global clarity, one secure sign-in.
            </h1>
            <p className="max-w-xl text-lg text-slate-300">
              Access the Claritas signal desk with your trusted identity provider. No passwords stored, no
              hidden redirects.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {featureList.map((feature, index) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur motion-safe:animate-[login-fade_900ms_ease-out_both]"
                style={{ animationDelay: `${index * 140}ms` }}
              >
                <div className="text-sm font-semibold text-[#f5efe6]">{feature.title}</div>
                <p className="mt-2 text-sm text-slate-300">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-[#f6f0e8] p-8 text-slate-900 shadow-[0_30px_80px_rgba(5,10,20,0.45)] motion-safe:animate-[login-fade_800ms_ease-out_both]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Secure access</div>
              <h2
                className="mt-2 text-2xl font-semibold text-slate-900"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Sign in to Claritas
              </h2>
            </div>
            <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#f5efe6]">
              {isChecking ? "Checking" : "Ready"}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            {providerMeta.map((meta) => (
              <ProviderButton
                key={meta.id}
                meta={meta}
                enabled={enabledMap.get(meta.id) ?? false}
                busy={isChecking}
                onClick={() => onSignIn(meta.id)}
              />
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm text-slate-600">
            {isChecking
              ? "Checking for active sessions and configured providers."
              : "Select a provider to continue. You will be redirected to complete sign-in."}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">No account yet?</div>
              <div className="text-xs text-slate-500">Request access to enable a provider for your team.</div>
            </div>
            {canSignUp ? (
              <a
                href={signUpHref}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#f5efe6] transition hover:bg-slate-800"
              >
                Request access
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="rounded-full bg-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"
              >
                Request access
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
