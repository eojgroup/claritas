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
      <div className={fallbackClassName} role="status">
        <div className="p-4 text-center text-xs text-[color:var(--shell-muted)]">
          <ImageOff className="mx-auto h-6 w-6" />
          <div className="mt-2">Satellite image temporarily unavailable.</div>
          {available.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSourceIndex(0);
                setFailed(false);
                setRetry((value) => value + 1);
              }}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-current px-2 py-1 font-semibold"
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
