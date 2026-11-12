/** Images must describe the selected development's recent time window. */
export function eventMediaWindow(event: { last_activity_time?: Date | string | null }) {
  const anchor = new Date(event.last_activity_time ?? "").getTime();
  if (!Number.isFinite(anchor)) return null;
  return { since: new Date(anchor - 72 * 3_600_000).toISOString(), until: new Date(anchor + 24 * 3_600_000).toISOString() };
}

export function isTimelyEventMedia(event: { last_activity_time?: Date | string | null }, date: Date | string | null | undefined) {
  const window = eventMediaWindow(event);
  const time = new Date(date ?? "").getTime();
  return Boolean(window && Number.isFinite(time) && time >= Date.parse(window.since) && time <= Date.parse(window.until));
}
