import { useMemo } from "react";
import { ArrowUpRight, Check, LockKeyhole, Radio, Satellite, ShieldCheck } from "lucide-react";
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
  helper: string;
};

const providerMeta: ProviderMeta[] = [
  {
    id: "google",
    label: "Continue with Google",
    helper: "Google Workspace or personal account",
  },
  {
    id: "microsoft",
    label: "Continue with Microsoft",
    helper: "Microsoft Entra ID or Microsoft 365",
  },
  {
    id: "apple",
    label: "Continue with Apple",
    helper: "Apple Account",
  },
];

const providerIcons: Record<AuthProviderId, string> = {
  google: googleIcon,
  microsoft: microsoftIcon,
  apple: appleIcon,
};

const intelligencePreviewUrl = `${import.meta.env.BASE_URL}claritas-intelligence-hero.jpg`;

const workspaceCapabilities = ["News", "Social", "Weather", "Markets", "Transport", "Satellite"];

function BrandMark() {
  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-[#0b1d2d] shadow-[0_12px_30px_rgba(0,0,0,0.24)]">
      <span className="absolute -left-3 top-1 h-8 w-8 rounded-full bg-[#4f819b]" />
      <span className="absolute left-1 top-1 h-8 w-8 rounded-full bg-[#d79460]" />
      <span className="absolute left-4 top-1 h-8 w-8 rounded-full bg-[#e6c29e]" />
      <span className="absolute left-[17px] top-2 h-6 w-6 rounded-full border-[5px] border-[#173249]" />
    </div>
  );
}

function ProviderButton({
  provider,
  busy,
  onClick,
}: {
  provider: ProviderMeta;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="group flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-left shadow-sm transition hover:-translate-y-px hover:border-slate-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c77943] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-65"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50">
        <img src={providerIcons[provider.id]} alt="" width={19} height={19} className="h-[19px] w-[19px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{provider.label}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">{provider.helper}</span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-[#173249]" aria-hidden="true" />
    </button>
  );
}

export default function LoginPage({ providers, status, error, onSignIn }: LoginPageProps) {
  const enabledProviders = useMemo(() => {
    const enabled = new Set(
      providers.filter((provider) => provider.enabled).map((provider) => provider.id),
    );
    return providerMeta.filter((provider) => enabled.has(provider.id));
  }, [providers]);
  const isChecking = status === "checking";

  return (
    <main className="min-h-[100dvh] bg-[#071725] p-3 text-white sm:p-5 lg:p-7">
      <div className="relative mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1440px] overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0b1e2f] shadow-[0_32px_90px_rgba(0,0,0,0.38)] lg:min-h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1.34fr)_minmax(26rem,0.66fr)]">
        <section className="relative order-2 flex min-h-[30rem] flex-col overflow-hidden p-6 sm:min-h-[34rem] sm:p-9 lg:order-1 lg:min-h-0 lg:p-12">
          <img
            src={intelligencePreviewUrl}
            alt="Satellite and map view representing the Claritas intelligence workspace"
            className="absolute inset-0 h-full w-full object-cover object-center opacity-80"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,20,34,0.98)_0%,rgba(5,20,34,0.82)_43%,rgba(5,20,34,0.18)_100%),linear-gradient(0deg,rgba(5,20,34,0.88)_0%,transparent_52%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(149,186,207,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(149,186,207,0.08)_1px,transparent_1px)] bg-[size:3.25rem_3.25rem] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />

          <div className="relative flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BrandMark />
              <div>
                <div className="text-sm font-semibold tracking-[0.22em] text-white">CLARITAS</div>
                <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-300">Global intelligence</div>
              </div>
            </div>
            <span className="hidden rounded-full border border-white/15 bg-slate-950/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200 backdrop-blur-sm sm:inline-flex">
              Map-led analysis
            </span>
          </div>

          <div className="relative mt-auto max-w-2xl pt-24 lg:pt-36">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#d99862]/35 bg-[#172c3d]/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f0c49e] backdrop-blur-sm">
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              Intelligence workspace
            </div>
            <h1 className="max-w-xl font-[var(--font-display)] text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
              See the signals that shape your next decision.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-200 sm:text-lg">
              Claritas brings material events, conditions, and evidence into one calm, map-led operating picture.
            </p>
          </div>

          <div className="relative mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-[#0b2031]/72 p-4 backdrop-blur-md">
              <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                <span>Workspace preview</span>
                <Satellite className="h-4 w-4 text-[#edab70]" aria-hidden="true" />
              </div>
              <div className="mt-3 text-sm font-semibold text-white">Signal Desk</div>
              <p className="mt-1 text-xs leading-5 text-slate-300">Correlated event context with source and satellite evidence.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-[#0b2031]/72 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                <ShieldCheck className="h-4 w-4 text-[#8fc5b6]" aria-hidden="true" />
                Enterprise controls
              </div>
              <div className="mt-3 text-sm font-semibold text-white">Traceable by design</div>
              <p className="mt-1 text-xs leading-5 text-slate-300">Identity, provenance, and access controls stay in view.</p>
            </div>
          </div>
        </section>

        <section className="relative order-1 flex items-center bg-[#f7f8fa] px-5 py-10 text-slate-900 sm:px-10 lg:order-2 lg:px-12">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <BrandMark />
              <div>
                <div className="text-sm font-semibold tracking-[0.22em] text-[#10283a]">CLARITAS</div>
                <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">Global intelligence</div>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <LockKeyhole className="h-3.5 w-3.5 text-[#2f6b62]" aria-hidden="true" />
              Secure access
            </div>
            <h2 className="mt-5 font-[var(--font-display)] text-3xl font-semibold tracking-[-0.025em] text-[#10283a]">
              Enter your workspace
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Sign in with the identity provider trusted by your organization. Claritas never asks for a separate password.
            </p>

            {error ? (
              <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-800">
                {error}
              </div>
            ) : null}

            <div className="mt-7 space-y-3">
              {isChecking ? (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                  Verifying secure sign-in options…
                </div>
              ) : enabledProviders.length > 0 ? (
                enabledProviders.map((provider) => (
                  <ProviderButton
                    key={provider.id}
                    provider={provider}
                    busy={false}
                    onClick={() => onSignIn(provider.id)}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-5 text-amber-900">
                  Sign-in is not configured yet. Ask your Claritas administrator to enable an identity provider.
                </div>
              )}
            </div>

            <div className="mt-7 border-t border-slate-200 pt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Your intelligence workspace</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {workspaceCapabilities.map((capability) => (
                  <span key={capability} className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/70 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    <Check className="h-3 w-3 text-[#2f6b62]" aria-hidden="true" />
                    {capability}
                  </span>
                ))}
              </div>
            </div>

            <p className="mt-8 text-xs leading-5 text-slate-500">
              Access is governed by your organization. A Claritas profile is created on first sign-in when your organization allows it.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
