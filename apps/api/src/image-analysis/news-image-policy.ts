/** Bytea previews remain short-lived and deduplicated; reuse never renews expiry. */
export function newsImageRetentionDays(value = process.env.NEWS_IMAGE_RETENTION_DAYS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(30, Math.trunc(parsed)) : 14;
}
