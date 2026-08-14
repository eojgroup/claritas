import nodemailer, { type Transporter } from "nodemailer";
import {
  renderBriefingMapPng,
  type BriefingEmailTheme,
  type BriefingMapCountry,
} from "./email-map";

export type EmailRuntimeConfig = {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  authenticated: boolean;
  from: string;
  reply_to: string | null;
  public_base_url: string | null;
};

export type BriefingEmailSignal = {
  title: string;
  original_title?: string | null;
  original_language?: string | null;
  summary: string | null;
  url: string | null;
  source_name: string;
  reasons: string[];
  translation?: {
    kind: "ai_translation";
    target_language: string;
    provider: string;
    model: string | null;
  } | null;
};

export type BriefingEmailEvent = {
  id: string;
  event_type: string;
  title: string;
  summary: string;
  severity: string;
  confidence: number;
  relevance_score: number;
  start_time: string | null;
  where: string;
  why_interesting: string[];
  profile_reasons: string[];
  linked_news: Array<{
    title: string;
    original_title?: string | null;
    original_language?: string | null;
    publisher: string;
    url: string | null;
    published_at: string | null;
    translation?: {
      kind: "ai_translation";
      target_language: string;
      provider: string;
      model: string | null;
    } | null;
  }>;
  earth_observation: Array<{
    product_type: string;
    provider: string;
    captured_at: string;
    imagery_available: boolean;
    evidentiary_role: string;
    analysis_summary: string | null;
    temporal_alignment: string | null;
    assessment_boundary: string | null;
  }>;
};

export type BriefingEmailMarket = {
  symbol: string;
  company_name: string | null;
  price: number | null;
  currency: string | null;
  percent_change: number | null;
};

export type BriefingEmailCountryProfile = {
  country_iso2: string;
  country_name: string;
  region: string | null;
  relevance_score: number;
  relevance_drivers: string[];
  news_count: number;
  podcast_count: number;
  market_count: number;
  transport: {
    active_count: number;
    ship_departures: number;
    tracked_flights: number;
  } | null;
  weather: {
    temp_c: number | null;
    humidity: number | null;
    weather_main: string | null;
    observed_at: string | null;
  } | null;
  leadership: {
    government_type: string | null;
    summary: string | null;
    roles: Array<{
      role_type: "head_of_state" | "head_of_government";
      person_name: string;
      started_at: string | null;
    }>;
  } | null;
};

export type BriefingEmailContent = {
  title: string;
  briefing_date: string;
  update_text: string;
  key_takeaways: string[];
  events: BriefingEmailEvent[];
  signals: BriefingEmailSignal[];
  markets: BriefingEmailMarket[];
  map_countries: BriefingMapCountry[];
  highest_relevance_country: BriefingEmailCountryProfile | null;
  theme: BriefingEmailTheme;
};

export type ImportantEventEmailContent = {
  event: BriefingEmailEvent;
  recipient_name: string | null;
  matched_watch: {
    type: string;
    key: string;
    minimum_severity: string;
  };
  profile_topics: string[];
  alert_created_at: string;
  theme: BriefingEmailTheme;
};

type BriefingEmailPalette = {
  page: string;
  panel: string;
  surface: string;
  surfaceMuted: string;
  ink: string;
  muted: string;
  border: string;
  accent: string;
  link: string;
  strong: string;
  onStrong: string;
};

const BRIEFING_EMAIL_PALETTES: Record<BriefingEmailTheme, BriefingEmailPalette> = {
  light: {
    page: "#F1EBDD",
    panel: "#FAF7EF",
    surface: "#FAF7EF",
    surfaceMuted: "#D8C6A3",
    ink: "#0B2028",
    muted: "#50645F",
    border: "#C9B58E",
    accent: "#A97846",
    link: "#2F6858",
    strong: "#244D42",
    onStrong: "#F1EBDD",
  },
  dark: {
    page: "#07151B",
    panel: "#0B2028",
    surface: "#15372F",
    surfaceMuted: "#244D42",
    ink: "#F1EBDD",
    muted: "#AFC0B8",
    border: "#3B6258",
    accent: "#D1B78A",
    link: "#8FBFAE",
    strong: "#244D42",
    onStrong: "#F1EBDD",
  },
};

const EMAIL_FONT = "'Times New Roman', Times, serif";

let transporter: Transporter | null = null;
let transporterKey: string | null = null;

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 587;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function getEmailRuntimeConfig(): EmailRuntimeConfig {
  const host = optionalEnv("SMTP_HOST");
  const port = parsePort(process.env.SMTP_PORT);
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);
  const fromAddress = optionalEnv("SMTP_FROM") || "briefings@claritas.local";
  const fromName = optionalEnv("SMTP_FROM_NAME") || "Claritas";
  const publicBaseUrl = optionalEnv("EMAIL_PUBLIC_BASE_URL");
  return {
    configured: Boolean(host),
    host,
    port,
    secure,
    authenticated: Boolean(optionalEnv("SMTP_USER")),
    from: `${fromName} <${fromAddress}>`,
    reply_to: optionalEnv("SMTP_REPLY_TO"),
    public_base_url: publicBaseUrl ? publicBaseUrl.replace(/\/+$/, "") : null,
  };
}

function getTransporter(): Transporter {
  const config = getEmailRuntimeConfig();
  if (!config.configured || !config.host) {
    throw new Error("SMTP delivery is not configured. Set SMTP_HOST before sending briefing email.");
  }

  const user = optionalEnv("SMTP_USER");
  const password = optionalEnv("SMTP_PASSWORD");
  if (user && !password) {
    throw new Error("SMTP_USER is set but SMTP_PASSWORD is missing.");
  }

  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user,
  });
  if (transporter && transporterKey === key) return transporter;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: user && password ? { user, pass: password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  transporterKey = key;
  return transporter;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeWebUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatMarketValue(market: BriefingEmailMarket): string {
  const price =
    typeof market.price === "number"
      ? `${market.currency ? `${market.currency} ` : ""}${market.price.toLocaleString("en", {
          maximumFractionDigits: 2,
        })}`
      : "Price unavailable";
  const move =
    typeof market.percent_change === "number"
      ? `${market.percent_change >= 0 ? "+" : ""}${market.percent_change.toFixed(2)}%`
      : null;
  return move ? `${price} · ${move}` : price;
}

function eventEvidenceUrl(eventId: string): string | null {
  const base = getEmailRuntimeConfig().public_base_url;
  if (!base) return null;
  try {
    const url = new URL("/", base);
    url.searchParams.set("event", eventId);
    return safeWebUrl(url.toString());
  } catch {
    return null;
  }
}

function exactUtcTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function translationDisclosure(input: {
  original_language?: string | null;
  translation?: { target_language: string; provider: string } | null;
}): string | null {
  if (!input.translation) return null;
  const source = input.original_language?.trim().toUpperCase() || "the source language";
  const target = input.translation.target_language.trim().toUpperCase() === "EN"
    ? "English"
    : input.translation.target_language.trim().toUpperCase();
  return `AI-translated from ${source} to ${target} for convenience`;
}

function eventHtml(event: BriefingEmailEvent, palette: BriefingEmailPalette): string {
  const profileReasons = event.profile_reasons.length
    ? `<div style="margin:10px 0 0;padding:10px 12px;border-left:3px solid ${palette.accent};background:${palette.surfaceMuted};color:${palette.ink}"><strong>Why it matches your profile</strong><br>${escapeHtml(event.profile_reasons.join(" · "))}</div>`
    : "";
  const why = event.why_interesting.slice(0, 6)
    .map((reason) => `<li style="margin:0 0 5px;color:${palette.ink}">${escapeHtml(reason)}</li>`)
    .join("");
  const news = event.linked_news.slice(0, 6).map((item) => {
    const url = safeWebUrl(item.url);
    const title = url
      ? `<a href="${escapeHtml(url)}" style="color:${palette.link};text-decoration:underline">${escapeHtml(item.title)}</a>`
      : escapeHtml(item.title);
    const publishedAt = exactUtcTimestamp(item.published_at);
    const disclosure = translationDisclosure(item);
    return `<li style="margin:0 0 6px;color:${palette.ink}">${title}<span style="color:${palette.muted}"> · ${escapeHtml(item.publisher)}${publishedAt ? ` · published ${escapeHtml(publishedAt)}` : " · publication time unavailable"}</span>${disclosure ? `<div style="font-size:11px;color:${palette.accent}">${escapeHtml(disclosure)}; original publisher text remains available at the source link.</div>` : ""}</li>`;
  }).join("");
  const eo = event.earth_observation.slice(0, 4).map((item) => {
    const role = item.evidentiary_role === "sensor_observation"
      ? "sensor-derived observation"
      : item.evidentiary_role === "model_interpretation"
        ? "model interpretation"
        : "visual context";
    const details = [item.provider, item.product_type.replace(/_/g, " "), role]
      .filter(Boolean).join(" · ");
    const capturedAt = exactUtcTimestamp(item.captured_at);
    return `<li style="margin:0 0 6px;color:${palette.ink}">${escapeHtml(details)}${capturedAt ? ` · captured ${escapeHtml(capturedAt)}` : " · capture time unavailable"}${item.temporal_alignment ? `<div style="color:${palette.muted}">${escapeHtml(item.temporal_alignment)}</div>` : ""}${item.assessment_boundary ? `<div style="color:${palette.muted}">${escapeHtml(item.assessment_boundary)}</div>` : ""}${item.analysis_summary ? `<div style="color:${palette.muted}">${escapeHtml(item.analysis_summary)}</div>` : ""}</li>`;
  }).join("");
  const eventUrl = eventEvidenceUrl(event.id);
  const eventLink = eventUrl
    ? `<a href="${escapeHtml(eventUrl)}" style="display:inline-block;margin-top:14px;padding:10px 14px;border-radius:8px;background:${palette.strong};color:${palette.onStrong};font-weight:700;text-decoration:none">Open event evidence/imagery</a>`
    : "";
  return `<div style="margin:14px 0 0;padding:16px 18px;border:1px solid ${palette.border};border-radius:12px;background:${palette.surface}">
    <div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${palette.accent}">${escapeHtml(event.severity)} · ${escapeHtml(event.event_type.replace(/_/g, " "))} · ${Math.round(event.confidence * 100)}% confidence</div>
    <h3 style="margin:7px 0 5px;font-family:${EMAIL_FONT};font-size:20px;color:${palette.ink}">${escapeHtml(event.title)}</h3>
    <div style="font-size:13px;color:${palette.muted}"><strong>Where:</strong> ${escapeHtml(event.where)}</div>
    <div style="font-size:13px;color:${palette.muted}"><strong>Event start:</strong> ${escapeHtml(exactUtcTimestamp(event.start_time) || "not yet resolved")}</div>
    <p style="margin:10px 0;color:${palette.ink};line-height:1.5">${escapeHtml(event.summary)}</p>
    ${profileReasons}
    ${why ? `<strong style="display:block;margin-top:12px;color:${palette.ink}">Why this is interesting</strong><ul style="margin:7px 0 0;padding-left:20px">${why}</ul>` : ""}
    ${news ? `<strong style="display:block;margin-top:12px;color:${palette.ink}">Linked news</strong><ul style="margin:7px 0 0;padding-left:20px">${news}</ul>` : ""}
    ${eo ? `<strong style="display:block;margin-top:12px;color:${palette.ink}">Earth observation</strong><ul style="margin:7px 0 0;padding-left:20px">${eo}</ul><div style="font-size:11px;color:${palette.muted}">Imagery and model interpretations provide governed context; they are not automatic proof of causation.</div>` : ""}
    ${eventLink}
  </div>`;
}

function eventText(event: BriefingEmailEvent): string[] {
  return [
    `${event.severity.toUpperCase()} · ${event.event_type.replace(/_/g, " ")} · ${Math.round(event.confidence * 100)}% confidence`,
    event.title,
    `Where: ${event.where}`,
    `Event start: ${exactUtcTimestamp(event.start_time) || "not yet resolved"}`,
    event.summary,
    ...(event.profile_reasons.length ? ["Why it matches your profile:", ...event.profile_reasons.map((reason) => `- ${reason}`)] : []),
    ...(event.why_interesting.length ? ["Why this is interesting:", ...event.why_interesting.map((reason) => `- ${reason}`)] : []),
    ...(event.linked_news.length ? ["Linked news:", ...event.linked_news.flatMap((item) => [
      `- ${item.title} · ${item.publisher} · ${exactUtcTimestamp(item.published_at) ? `published ${exactUtcTimestamp(item.published_at)}` : "publication time unavailable"}`,
      ...(translationDisclosure(item) ? [`  ${translationDisclosure(item)}; original publisher text remains available at the source link.`] : []),
      ...(safeWebUrl(item.url) ? [`  ${safeWebUrl(item.url)}`] : []),
    ])] : []),
    ...(event.earth_observation.length ? ["Earth observation:", ...event.earth_observation.map((item) =>
      `- ${item.provider} · ${item.product_type.replace(/_/g, " ")} · ${item.evidentiary_role.replace(/_/g, " ")}${exactUtcTimestamp(item.captured_at) ? ` · captured ${exactUtcTimestamp(item.captured_at)}` : " · capture time unavailable"}${item.temporal_alignment ? ` · ${item.temporal_alignment}` : ""}${item.assessment_boundary ? ` · ${item.assessment_boundary}` : ""}${item.analysis_summary ? ` · ${item.analysis_summary}` : ""}`
    ), "Imagery and model interpretations provide context; they are not automatic proof of causation."] : []),
    ...(eventEvidenceUrl(event.id) ? [`Open event evidence/imagery: ${eventEvidenceUrl(event.id)}`] : []),
  ];
}

export function renderBriefingEmail(
  content: BriefingEmailContent,
  options: { map_cid?: string | null } = {}
): {
  subject: string;
  html: string;
  text: string;
} {
  const config = getEmailRuntimeConfig();
  const theme: BriefingEmailTheme = content.theme === "light" ? "light" : "dark";
  const palette = BRIEFING_EMAIL_PALETTES[theme];
  const subject = `${content.title} — ${content.briefing_date}`;
  const takeawayHtml = content.key_takeaways
    .map(
      (takeaway) =>
        `<li style="margin:0 0 8px;color:${palette.ink}">${escapeHtml(takeaway)}</li>`
    )
    .join("");
  const eventsHtml = content.events.slice(0, 8).map((event) => eventHtml(event, palette)).join("");
  const signalHtml = content.signals
    .map((signal) => {
      const url = safeWebUrl(signal.url);
      const title = escapeHtml(signal.title);
      const linkedTitle = url
        ? `<a href="${escapeHtml(url)}" style="color:${palette.link};text-decoration:underline">${title}</a>`
        : title;
      const reasons = signal.reasons.length > 0 ? ` · ${escapeHtml(signal.reasons.join(", "))}` : "";
      const summary = signal.summary
        ? `<div style="margin-top:5px;color:${palette.muted}">${escapeHtml(signal.summary)}</div>`
        : "";
      const disclosure = translationDisclosure(signal);
      return `<li style="margin:0 0 14px;color:${palette.ink}"><strong>${linkedTitle}</strong><div style="font-size:12px;color:${palette.muted}">${escapeHtml(signal.source_name)}${reasons}</div>${disclosure ? `<div style="font-size:11px;color:${palette.accent}">${escapeHtml(disclosure)}; original publisher text remains available at the source link.</div>` : ""}${summary}</li>`;
    })
    .join("");
  const marketHtml = content.markets
    .map(
      (market) =>
        `<li style="margin:0 0 8px;color:${palette.ink}"><strong>${escapeHtml(market.symbol)}</strong>${market.company_name ? ` · ${escapeHtml(market.company_name)}` : ""}<div style="font-size:12px;color:${palette.muted}">${escapeHtml(formatMarketValue(market))}</div></li>`
    )
    .join("");
  const mapHtml = options.map_cid
    ? `<h2 style="margin:26px 0 10px;font-family:${EMAIL_FONT};font-size:20px;color:${palette.ink}">Geospatial signal pulse</h2>
       <img src="cid:${escapeHtml(options.map_cid)}" width="624" alt="World map showing the countries most relevant to this briefing" style="display:block;width:100%;max-width:624px;height:auto;border:0;border-radius:12px;background:${palette.page}" />`
    : "";
  const countryProfile = content.highest_relevance_country;
  const countryProfileHtml = countryProfile
    ? (() => {
        const weather = countryProfile.weather;
        const metricCells = [
          ["Relevance", `${Math.round(countryProfile.relevance_score)}/100`],
          ["News", String(countryProfile.news_count)],
          ["Weather", weather?.temp_c == null ? "—" : `${weather.temp_c.toFixed(1)}°C`],
          ["Podcast", String(countryProfile.podcast_count)],
          ["Leadership", String(countryProfile.leadership?.roles.length ?? 0)],
          ["Markets", String(countryProfile.market_count)],
          ["Transport", String(countryProfile.transport?.active_count ?? 0)],
        ]
          .map(
            ([label, value]) =>
              `<td style="padding:10px 8px;border:1px solid ${palette.border};text-align:center"><div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${palette.muted}">${escapeHtml(
                label
              )}</div><strong style="display:block;margin-top:4px;font-size:17px;color:${palette.ink}">${escapeHtml(
                value
              )}</strong></td>`
          )
          .join("");
        const drivers = countryProfile.relevance_drivers
          .slice(0, 5)
          .map(
            (driver) =>
              `<li style="margin:0 0 6px;color:${palette.ink}">${escapeHtml(driver)}</li>`
          )
          .join("");
        const weatherHtml = weather
          ? `<p style="margin:12px 0 0;color:${palette.ink}"><strong>Weather:</strong> ${
              weather.temp_c == null ? "Temperature unavailable" : `${weather.temp_c.toFixed(1)}°C`
            }${weather.weather_main ? ` · ${escapeHtml(weather.weather_main)}` : ""}${
              weather.humidity == null ? "" : ` · ${weather.humidity}% humidity`
            }</p>`
          : "";
        const leadershipHtml =
          countryProfile.leadership?.roles.length
            ? `<p style="margin:12px 0 4px;color:${palette.ink}"><strong>Current leadership${
                countryProfile.leadership.government_type
                  ? ` · ${escapeHtml(countryProfile.leadership.government_type)}`
                  : ""
              }</strong></p><ul style="margin:4px 0 0;padding-left:20px">${countryProfile.leadership.roles
                .slice(0, 4)
                .map(
                  (role) =>
                    `<li style="margin:0 0 5px;color:${palette.ink}">${escapeHtml(
                      role.role_type === "head_of_state"
                        ? "Head of state"
                        : "Head of government"
                    )}: ${escapeHtml(role.person_name)}${
                      role.started_at
                        ? ` <span style="color:${palette.muted}">(since ${escapeHtml(
                            role.started_at.slice(0, 10)
                          )})</span>`
                        : ""
                    }</li>`
                )
                .join("")}</ul>`
            : "";
        return `<div style="margin-top:14px;border:1px solid ${palette.border};border-radius:12px;overflow:hidden">
          <div style="padding:16px 18px;background:${palette.strong};color:${palette.onStrong}">
            <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${palette.accent}">Highest relevance country · ${escapeHtml(
              countryProfile.country_iso2
            )}</div>
            <div style="margin-top:5px;font-family:${EMAIL_FONT};font-size:22px;font-weight:700">${escapeHtml(
              countryProfile.country_name
            )}</div>
            <div style="font-size:12px;color:${palette.onStrong}">${escapeHtml(
              countryProfile.region || "Global country context"
            )}</div>
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:${palette.surfaceMuted};font-family:${EMAIL_FONT}"><tr>${metricCells}</tr></table>
          <div style="padding:16px 18px;background:${palette.surface}">
            ${drivers ? `<strong style="font-size:13px;color:${palette.ink}">Why this country is relevant</strong><ul style="margin:8px 0 0;padding-left:20px">${drivers}</ul>` : ""}
            ${weatherHtml}
            ${leadershipHtml}
          </div>
        </div>`;
      })()
    : "";
  const preferencesUrl = config.public_base_url ? `${config.public_base_url}/?view=profile` : null;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta name="color-scheme" content="${theme}">
    <meta name="supported-color-schemes" content="${theme}">
  </head>
  <body style="margin:0;background:${palette.page};color:${palette.ink};font-family:${EMAIL_FONT}">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(content.update_text.slice(0, 140))}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${palette.page};font-family:${EMAIL_FONT}">
      <tr><td align="center" style="padding:24px 12px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:${palette.panel};border:1px solid ${palette.border};border-radius:14px;font-family:${EMAIL_FONT}">
          <tr><td style="padding:28px">
            <div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:${palette.accent};text-transform:uppercase">Claritas personalised briefing</div>
            <h1 style="margin:10px 0 6px;font-family:${EMAIL_FONT};font-size:30px;line-height:1.2;color:${palette.ink}">${escapeHtml(content.title)}</h1>
            <div style="font-size:13px;color:${palette.muted}">${escapeHtml(content.briefing_date)}</div>
            <p style="font-size:16px;line-height:1.6;color:${palette.ink}">${escapeHtml(content.update_text)}</p>
            ${mapHtml}
            ${countryProfileHtml}
            ${
              eventsHtml
                ? `<h2 style="margin:26px 0 10px;font-family:${EMAIL_FONT};font-size:20px;color:${palette.ink}">Priority events for your profile</h2>${eventsHtml}`
                : ""
            }
            ${
              takeawayHtml
                ? `<h2 style="margin:26px 0 10px;font-family:${EMAIL_FONT};font-size:20px;color:${palette.ink}">Key takeaways</h2><ul style="padding-left:20px;line-height:1.5">${takeawayHtml}</ul>`
                : ""
            }
            ${
              signalHtml
                ? `<h2 style="margin:26px 0 10px;font-family:${EMAIL_FONT};font-size:20px;color:${palette.ink}">Signals selected for you</h2><ol style="padding-left:22px;line-height:1.45">${signalHtml}</ol>`
                : ""
            }
            ${
              marketHtml
                ? `<h2 style="margin:26px 0 10px;font-family:${EMAIL_FONT};font-size:20px;color:${palette.ink}">Companies you follow</h2><ul style="padding-left:20px;line-height:1.45">${marketHtml}</ul>`
                : ""
            }
            <div style="margin-top:28px;padding-top:18px;border-top:1px solid ${palette.border};font-size:12px;color:${palette.muted}">
              You received this because daily briefing email is enabled for your Claritas account.
              ${preferencesUrl ? ` <a href="${escapeHtml(preferencesUrl)}" style="color:${palette.link}">Manage briefing preferences</a>.` : " You can disable it in your Claritas profile."}
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const textParts = [
    content.title,
    content.briefing_date,
    "",
    content.update_text,
    "",
    ...(countryProfile
      ? [
          "HIGHEST RELEVANCE COUNTRY",
          `${countryProfile.country_name} (${countryProfile.country_iso2}) — ${Math.round(
            countryProfile.relevance_score
          )}/100`,
          ...countryProfile.relevance_drivers.map((driver) => `- ${driver}`),
          ...(countryProfile.weather
            ? [
                `Weather: ${
                  countryProfile.weather.temp_c == null
                    ? "temperature unavailable"
                    : `${countryProfile.weather.temp_c.toFixed(1)}°C`
                }${
                  countryProfile.weather.weather_main
                    ? ` · ${countryProfile.weather.weather_main}`
                    : ""
                }`,
              ]
            : []),
          ...(countryProfile.leadership?.roles ?? []).map(
            (role) =>
              `${role.role_type === "head_of_state" ? "Head of state" : "Head of government"}: ${
                role.person_name
              }`
          ),
          ...(countryProfile.transport
            ? [
                `Transport: ${countryProfile.transport.active_count} active links · ${countryProfile.transport.ship_departures} ship departures · ${countryProfile.transport.tracked_flights} tracked flights`,
              ]
            : []),
          "",
        ]
      : []),
    ...(content.key_takeaways.length
      ? ["KEY TAKEAWAYS", ...content.key_takeaways.map((item) => `- ${item}`), ""]
      : []),
    ...(content.events.length
      ? ["PRIORITY EVENTS FOR YOUR PROFILE", ...content.events.flatMap((event) => [...eventText(event), ""])]
      : []),
    ...(content.signals.length
      ? [
          "SIGNALS SELECTED FOR YOU",
          ...content.signals.flatMap((signal) => [
            `- ${signal.title} (${signal.source_name}${signal.reasons.length ? `; ${signal.reasons.join(", ")}` : ""})`,
            ...(signal.summary ? [`  ${signal.summary}`] : []),
            ...(safeWebUrl(signal.url) ? [`  ${safeWebUrl(signal.url)}`] : []),
          ]),
          "",
        ]
      : []),
    ...(content.markets.length
      ? [
          "COMPANIES YOU FOLLOW",
          ...content.markets.map(
            (market) =>
              `- ${market.symbol}${market.company_name ? ` · ${market.company_name}` : ""}: ${formatMarketValue(market)}`
          ),
          "",
        ]
      : []),
    preferencesUrl
      ? `Manage briefing preferences: ${preferencesUrl}`
      : "Manage or disable briefing email in your Claritas profile.",
  ];

  return { subject, html, text: textParts.join("\n") };
}

export function renderImportantEventEmail(content: ImportantEventEmailContent): {
  subject: string;
  html: string;
  text: string;
  preferences_url: string | null;
} {
  const config = getEmailRuntimeConfig();
  const palette = BRIEFING_EMAIL_PALETTES[content.theme === "light" ? "light" : "dark"];
  const event = content.event;
  const severity = event.severity.toUpperCase();
  const subject = `[${severity}] ${event.title}`.slice(0, 180);
  const preferencesUrl = config.public_base_url
    ? `${config.public_base_url}/?view=profile&section=notifications`
    : null;
  const greeting = content.recipient_name ? `For ${content.recipient_name}` : "Matched to your Claritas profile";
  const profileTopics = content.profile_topics.length
    ? `<p style="margin:8px 0 0;color:${palette.muted}"><strong>Profile topics:</strong> ${escapeHtml(content.profile_topics.join(" · "))}</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta name="color-scheme" content="${content.theme}"></head>
  <body style="margin:0;background:${palette.page};color:${palette.ink};font-family:${EMAIL_FONT}">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(`${event.where} · ${event.summary}`.slice(0, 180))}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${palette.page}"><tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:${palette.panel};border:1px solid ${palette.border};border-radius:14px"><tr><td style="padding:28px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:${palette.accent};text-transform:uppercase">Claritas important event · ${escapeHtml(severity)}</div>
        <h1 style="margin:10px 0 6px;font-family:${EMAIL_FONT};font-size:29px;line-height:1.2;color:${palette.ink}">${escapeHtml(event.title)}</h1>
        <div style="font-size:13px;color:${palette.muted}">${escapeHtml(greeting)} · Alert created ${escapeHtml(exactUtcTimestamp(content.alert_created_at) || "time unavailable")}</div>
        ${eventHtml(event, palette)}
        <div style="margin-top:16px;padding:14px;background:${palette.surfaceMuted};border:1px solid ${palette.border};border-radius:10px;color:${palette.ink}">
          <strong>Notification profile</strong>
          <p style="margin:8px 0 0">Matched watch: ${escapeHtml(content.matched_watch.type.replace(/_/g, " "))} · ${escapeHtml(content.matched_watch.key)} · minimum ${escapeHtml(content.matched_watch.minimum_severity)} severity</p>
          ${profileTopics}
        </div>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid ${palette.border};font-size:12px;color:${palette.muted}">
          You received this because event alerts and email delivery are enabled for your verified Claritas account.
          ${preferencesUrl ? ` <a href="${escapeHtml(preferencesUrl)}" style="color:${palette.link}">Manage or disable notifications</a>.` : " Disable email delivery or this watch in your Claritas profile."}
        </div>
      </td></tr></table>
    </td></tr></table>
  </body></html>`;
  const text = [
    `CLARITAS IMPORTANT EVENT · ${severity}`,
    greeting,
    `Alert created: ${exactUtcTimestamp(content.alert_created_at) || "time unavailable"}`,
    "",
    ...eventText(event),
    "",
    "NOTIFICATION PROFILE",
    `Matched watch: ${content.matched_watch.type.replace(/_/g, " ")} · ${content.matched_watch.key} · minimum ${content.matched_watch.minimum_severity} severity`,
    ...(content.profile_topics.length ? [`Profile topics: ${content.profile_topics.join(" · ")}`] : []),
    "",
    preferencesUrl
      ? `Manage or disable notifications: ${preferencesUrl}`
      : "Manage or disable email delivery and watches in your Claritas profile.",
  ].join("\n");
  return { subject, html, text, preferences_url: preferencesUrl };
}

export async function sendImportantEventEmail(
  recipient: string,
  content: ImportantEventEmailContent,
  options: { message_id: string },
): Promise<{ message_id: string | null }> {
  const config = getEmailRuntimeConfig();
  const rendered = renderImportantEventEmail(content);
  const headers: Record<string, string> = {
    "X-Claritas-Message-Type": "important-intelligence-event",
    "X-Claritas-Event-ID": content.event.id,
  };
  if (rendered.preferences_url) headers["List-Unsubscribe"] = `<${rendered.preferences_url}>`;
  const info = await getTransporter().sendMail({
    from: config.from,
    to: recipient,
    replyTo: config.reply_to || undefined,
    messageId: options.message_id,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    headers,
  });
  return { message_id: typeof info.messageId === "string" ? info.messageId : null };
}

export async function sendBriefingEmail(
  recipient: string,
  content: BriefingEmailContent
): Promise<{ message_id: string | null }> {
  const config = getEmailRuntimeConfig();
  const mapCid = `claritas-briefing-map-${content.briefing_date}@claritas`;
  let mapImage: Buffer | null = null;
  if (content.map_countries.length > 0) {
    try {
      mapImage = await renderBriefingMapPng(content.map_countries, content.theme);
    } catch (error) {
      console.warn(
        "Briefing map rendering failed; sending the email without the image:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  const rendered = renderBriefingEmail(content, {
    map_cid: mapImage ? mapCid : null,
  });
  const info = await getTransporter().sendMail({
    from: config.from,
    to: recipient,
    replyTo: config.reply_to || undefined,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: mapImage
      ? [
          {
            filename: `claritas-signal-map-${content.briefing_date}.png`,
            content: mapImage,
            contentType: "image/png",
            cid: mapCid,
            contentDisposition: "inline",
          },
        ]
      : undefined,
    headers: {
      "X-Claritas-Message-Type": "personal-daily-briefing",
    },
  });
  return { message_id: typeof info.messageId === "string" ? info.messageId : null };
}

export async function sendEmailVerificationEmail(recipient: string, verificationUrl: string): Promise<void> {
  const config = getEmailRuntimeConfig();
  const palette = BRIEFING_EMAIL_PALETTES.light;
  const url = safeWebUrl(verificationUrl);
  if (!url) throw new Error("EMAIL_PUBLIC_BASE_URL must be a valid HTTP(S) URL before sending verification email.");
  const destination = new URL(url);
  await getTransporter().sendMail({
    from: config.from,
    to: recipient,
    replyTo: config.reply_to || undefined,
    subject: "Verify your Claritas email address",
    text: `Verify your Claritas email address by opening this link:\n\n${url}\n\nThe destination is ${destination.origin}. Email security systems can replace clickable links with a redirect. If your browser warns about a redirect, copy and paste the exact Claritas address above into your browser instead.\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    html: `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:${palette.page};color:${palette.ink};font-family:${EMAIL_FONT}"><div style="max-width:640px;margin:0 auto;padding:28px;background:${palette.panel};border:1px solid ${palette.border};border-radius:14px"><div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:${palette.accent};text-transform:uppercase">Claritas account security</div><h1 style="font-family:${EMAIL_FONT};color:${palette.ink}">Verify your Claritas email address</h1><p><a href="${escapeHtml(url)}" style="color:${palette.link};font-weight:700">Verify email address</a></p><p style="color:${palette.muted}">The destination is <strong>${escapeHtml(destination.origin)}</strong>. Email security systems can replace clickable links with a redirect. If your browser warns about a redirect, copy and paste this exact Claritas address into your browser instead:</p><div style="padding:12px;background:${palette.surfaceMuted};border:1px solid ${palette.border};border-radius:8px;word-break:break-all"><code>${escapeHtml(url)}</code></div><p>This link expires in one hour. If you did not request it, you can ignore this email.</p></div></body></html>`,
    headers: { "X-Claritas-Message-Type": "email-verification" },
  });
}
