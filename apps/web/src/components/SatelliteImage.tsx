import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ImageOff, RotateCcw } from "lucide-react";
import { imageProxy } from "../lib/api";

type Props = {
  sources: Array<string | null | undefined>;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  loading?: "eager" | "lazy";
  style?: CSSProperties;
};

function displayUrl(source: string, retry: number) {
  const external = /^https:\/\//i.test(source);
  const resolved = external ? imageProxy(source) ?? source : source;
  if (retry === 0) return resolved;
  return `${resolved}${resolved.includes("?") ? "&" : "?"}image_retry=${retry}`;
}

export default function SatelliteImage({
  sources,
  alt,
  className = "h-full w-full object-cover",
  fallbackClassName = "flex h-full w-full items-center justify-center bg-slate-900/20",
  loading = "lazy",
  style,
}: Props) {
  const available = useMemo(
    () => [...new Set(sources.filter((source): source is string => Boolean(source?.trim())))],
    [sources],
  );
  const sourceKey = available.join("|");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setRetry(0);
    setFailed(false);
  }, [sourceKey]);

  const source = available[sourceIndex];
  if (!source || failed) {
    return (
      <div
        className={`${fallbackClassName} overflow-hidden text-[color:var(--shell-muted)]`}
        style={{ backgroundColor: "var(--shell-sidebar)" }}
        role="status"
      >
        <div className="mx-auto max-w-64 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)]/85 px-3 py-2.5 text-center text-[11px] leading-4 shadow-sm">
          <ImageOff className="mx-auto h-4 w-4" />
          {alt && (
            <>
              <div className="mt-1 font-semibold text-[color:var(--shell-ink)]">Imagery unavailable</div>
              <div className="mt-0.5">{available.length ? "The visual asset could not be decoded." : "No visual asset is attached to this observation."}</div>
            </>
          )}
          {available.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSourceIndex(0);
                setFailed(false);
                setRetry((value) => value + 1);
              }}
              className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-current px-2 py-0.5 font-semibold"
            >
              <RotateCcw className="h-3 w-3" /> Retry image
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <img
      src={displayUrl(source, retry)}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        if (sourceIndex + 1 < available.length) setSourceIndex((value) => value + 1);
        else setFailed(true);
      }}
    />
  );
}
