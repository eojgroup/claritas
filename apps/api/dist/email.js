"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailRuntimeConfig = getEmailRuntimeConfig;
exports.renderBriefingEmail = renderBriefingEmail;
exports.sendBriefingEmail = sendBriefingEmail;
exports.sendEmailVerificationEmail = sendEmailVerificationEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const email_map_1 = require("./email-map");
let transporter = null;
let transporterKey = null;
function optionalEnv(name) {
    const value = process.env[name]?.trim();
    return value || null;
}
function parsePort(value) {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 587;
}
function parseBoolean(value, fallback) {
    if (typeof value !== "string" || !value.trim())
        return fallback;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
function getEmailRuntimeConfig() {
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
function getTransporter() {
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
    if (transporter && transporterKey === key)
        return transporter;
    transporter = nodemailer_1.default.createTransport({
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
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function safeWebUrl(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    }
    catch {
        return null;
    }
}
function formatMarketValue(market) {
    const price = typeof market.price === "number"
        ? `${market.currency ? `${market.currency} ` : ""}${market.price.toLocaleString("en", {
            maximumFractionDigits: 2,
        })}`
        : "Price unavailable";
    const move = typeof market.percent_change === "number"
        ? `${market.percent_change >= 0 ? "+" : ""}${market.percent_change.toFixed(2)}%`
        : null;
    return move ? `${price} · ${move}` : price;
}
function renderBriefingEmail(content, options = {}) {
    const config = getEmailRuntimeConfig();
    const subject = `${content.title} — ${content.briefing_date}`;
    const takeawayHtml = content.key_takeaways
        .map((takeaway) => `<li style="margin:0 0 8px">${escapeHtml(takeaway)}</li>`)
        .join("");
    const signalHtml = content.signals
        .map((signal) => {
        const url = safeWebUrl(signal.url);
        const title = escapeHtml(signal.title);
        const linkedTitle = url
            ? `<a href="${escapeHtml(url)}" style="color:#164e63;text-decoration:underline">${title}</a>`
            : title;
        const reasons = signal.reasons.length > 0 ? ` · ${escapeHtml(signal.reasons.join(", "))}` : "";
        const summary = signal.summary
            ? `<div style="margin-top:5px;color:#475569">${escapeHtml(signal.summary)}</div>`
            : "";
        return `<li style="margin:0 0 14px"><strong>${linkedTitle}</strong><div style="font-size:12px;color:#64748b">${escapeHtml(signal.source_name)}${reasons}</div>${summary}</li>`;
    })
        .join("");
    const marketHtml = content.markets
        .map((market) => `<li style="margin:0 0 8px"><strong>${escapeHtml(market.symbol)}</strong>${market.company_name ? ` · ${escapeHtml(market.company_name)}` : ""}<div style="font-size:12px;color:#64748b">${escapeHtml(formatMarketValue(market))}</div></li>`)
        .join("");
    const mapHtml = options.map_cid
        ? `<h2 style="margin:26px 0 10px;font-size:18px">Geospatial signal pulse</h2>
       <img src="cid:${escapeHtml(options.map_cid)}" width="624" alt="World map showing the countries most relevant to this briefing" style="display:block;width:100%;max-width:624px;height:auto;border:0;border-radius:12px;background:#07121a" />`
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
            ]
                .map(([label, value]) => `<td style="padding:10px 8px;border:1px solid #d7e1e6;text-align:center"><div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#64748b">${escapeHtml(label)}</div><strong style="display:block;margin-top:4px;font-size:17px;color:#0f172a">${escapeHtml(value)}</strong></td>`)
                .join("");
            const drivers = countryProfile.relevance_drivers
                .slice(0, 5)
                .map((driver) => `<li style="margin:0 0 6px;color:#334155">${escapeHtml(driver)}</li>`)
                .join("");
            const weatherHtml = weather
                ? `<p style="margin:12px 0 0;color:#334155"><strong>Weather:</strong> ${weather.temp_c == null ? "Temperature unavailable" : `${weather.temp_c.toFixed(1)}°C`}${weather.weather_main ? ` · ${escapeHtml(weather.weather_main)}` : ""}${weather.humidity == null ? "" : ` · ${weather.humidity}% humidity`}</p>`
                : "";
            const leadershipHtml = countryProfile.leadership?.roles.length
                ? `<p style="margin:12px 0 4px;color:#334155"><strong>Current leadership${countryProfile.leadership.government_type
                    ? ` · ${escapeHtml(countryProfile.leadership.government_type)}`
                    : ""}</strong></p><ul style="margin:4px 0 0;padding-left:20px">${countryProfile.leadership.roles
                    .slice(0, 4)
                    .map((role) => `<li style="margin:0 0 5px;color:#334155">${escapeHtml(role.role_type === "head_of_state"
                    ? "Head of state"
                    : "Head of government")}: ${escapeHtml(role.person_name)}${role.started_at
                    ? ` <span style="color:#64748b">(since ${escapeHtml(role.started_at.slice(0, 10))})</span>`
                    : ""}</li>`)
                    .join("")}</ul>`
                : "";
            return `<div style="margin-top:14px;border:1px solid #d7e1e6;border-radius:12px;overflow:hidden">
          <div style="padding:16px 18px;background:#0d202b;color:#f8fafc">
            <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9fb0ba">Highest relevance country · ${escapeHtml(countryProfile.country_iso2)}</div>
            <div style="margin-top:5px;font-size:22px;font-weight:700">${escapeHtml(countryProfile.country_name)}</div>
            <div style="font-size:12px;color:#bdcbd2">${escapeHtml(countryProfile.region || "Global country context")}</div>
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f8fafc"><tr>${metricCells}</tr></table>
          <div style="padding:16px 18px;background:#ffffff">
            ${drivers ? `<strong style="font-size:13px;color:#0f172a">Why this country is relevant</strong><ul style="margin:8px 0 0;padding-left:20px">${drivers}</ul>` : ""}
            ${weatherHtml}
            ${leadershipHtml}
          </div>
        </div>`;
        })()
        : "";
    const preferencesUrl = config.public_base_url ? `${config.public_base_url}/?view=profile` : null;
    const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(content.update_text.slice(0, 140))}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc">
      <tr><td align="center" style="padding:24px 12px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px">
          <tr><td style="padding:28px">
            <div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:#0e7490;text-transform:uppercase">Claritas personalised briefing</div>
            <h1 style="margin:10px 0 6px;font-size:28px;line-height:1.2">${escapeHtml(content.title)}</h1>
            <div style="font-size:13px;color:#64748b">${escapeHtml(content.briefing_date)}</div>
            <p style="font-size:16px;line-height:1.6">${escapeHtml(content.update_text)}</p>
            ${mapHtml}
            ${countryProfileHtml}
            ${takeawayHtml
        ? `<h2 style="margin:26px 0 10px;font-size:18px">Key takeaways</h2><ul style="padding-left:20px;line-height:1.5">${takeawayHtml}</ul>`
        : ""}
            ${signalHtml
        ? `<h2 style="margin:26px 0 10px;font-size:18px">Signals selected for you</h2><ol style="padding-left:22px;line-height:1.45">${signalHtml}</ol>`
        : ""}
            ${marketHtml
        ? `<h2 style="margin:26px 0 10px;font-size:18px">Companies you follow</h2><ul style="padding-left:20px;line-height:1.45">${marketHtml}</ul>`
        : ""}
            <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
              You received this because daily briefing email is enabled for your Claritas account.
              ${preferencesUrl ? ` <a href="${escapeHtml(preferencesUrl)}" style="color:#164e63">Manage briefing preferences</a>.` : " You can disable it in your Claritas profile."}
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
                `${countryProfile.country_name} (${countryProfile.country_iso2}) — ${Math.round(countryProfile.relevance_score)}/100`,
                ...countryProfile.relevance_drivers.map((driver) => `- ${driver}`),
                ...(countryProfile.weather
                    ? [
                        `Weather: ${countryProfile.weather.temp_c == null
                            ? "temperature unavailable"
                            : `${countryProfile.weather.temp_c.toFixed(1)}°C`}${countryProfile.weather.weather_main
                            ? ` · ${countryProfile.weather.weather_main}`
                            : ""}`,
                    ]
                    : []),
                ...(countryProfile.leadership?.roles ?? []).map((role) => `${role.role_type === "head_of_state" ? "Head of state" : "Head of government"}: ${role.person_name}`),
                "",
            ]
            : []),
        ...(content.key_takeaways.length
            ? ["KEY TAKEAWAYS", ...content.key_takeaways.map((item) => `- ${item}`), ""]
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
                ...content.markets.map((market) => `- ${market.symbol}${market.company_name ? ` · ${market.company_name}` : ""}: ${formatMarketValue(market)}`),
                "",
            ]
            : []),
        preferencesUrl
            ? `Manage briefing preferences: ${preferencesUrl}`
            : "Manage or disable briefing email in your Claritas profile.",
    ];
    return { subject, html, text: textParts.join("\n") };
}
async function sendBriefingEmail(recipient, content) {
    const config = getEmailRuntimeConfig();
    const mapCid = `claritas-briefing-map-${content.briefing_date}@claritas`;
    let mapImage = null;
    if (content.map_countries.length > 0) {
        try {
            mapImage = await (0, email_map_1.renderBriefingMapPng)(content.map_countries);
        }
        catch (error) {
            console.warn("Briefing map rendering failed; sending the email without the image:", error instanceof Error ? error.message : String(error));
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
async function sendEmailVerificationEmail(recipient, verificationUrl) {
    const config = getEmailRuntimeConfig();
    const url = safeWebUrl(verificationUrl);
    if (!url)
        throw new Error("EMAIL_PUBLIC_BASE_URL must be a valid HTTP(S) URL before sending verification email.");
    const destination = new URL(url);
    await getTransporter().sendMail({
        from: config.from,
        to: recipient,
        replyTo: config.reply_to || undefined,
        subject: "Verify your Claritas email address",
        text: `Verify your Claritas email address by opening this link:\n\n${url}\n\nThe destination is ${destination.origin}. Email security systems can replace clickable links with a redirect. If your browser warns about a redirect, copy and paste the exact Claritas address above into your browser instead.\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
        html: `<p>Verify your Claritas email address:</p><p><a href="${escapeHtml(url)}">Verify email address</a></p><p style="color:#475569">The destination is <strong>${escapeHtml(destination.origin)}</strong>. Email security systems can replace clickable links with a redirect. If your browser warns about a redirect, copy and paste this exact Claritas address into your browser instead:</p><div style="padding:12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;word-break:break-all"><code>${escapeHtml(url)}</code></div><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`,
        headers: { "X-Claritas-Message-Type": "email-verification" },
    });
}
