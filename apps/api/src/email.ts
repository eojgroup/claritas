import nodemailer, { type Transporter } from "nodemailer";

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
  summary: string | null;
  url: string | null;
  source_name: string;
  reasons: string[];
};

export type BriefingEmailMarket = {
  symbol: string;
  company_name: string | null;
  price: number | null;
  currency: string | null;
  percent_change: number | null;
};

export type BriefingEmailContent = {
  title: string;
  briefing_date: string;
  update_text: string;
  key_takeaways: string[];
  signals: BriefingEmailSignal[];
  markets: BriefingEmailMarket[];
};

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

export function renderBriefingEmail(content: BriefingEmailContent): {
  subject: string;
  html: string;
  text: string;
} {
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
    .map(
      (market) =>
        `<li style="margin:0 0 8px"><strong>${escapeHtml(market.symbol)}</strong>${market.company_name ? ` · ${escapeHtml(market.company_name)}` : ""}<div style="font-size:12px;color:#64748b">${escapeHtml(formatMarketValue(market))}</div></li>`
    )
    .join("");
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
            ${
              takeawayHtml
                ? `<h2 style="margin:26px 0 10px;font-size:18px">Key takeaways</h2><ul style="padding-left:20px;line-height:1.5">${takeawayHtml}</ul>`
                : ""
            }
            ${
              signalHtml
                ? `<h2 style="margin:26px 0 10px;font-size:18px">Signals selected for you</h2><ol style="padding-left:22px;line-height:1.45">${signalHtml}</ol>`
                : ""
            }
            ${
              marketHtml
                ? `<h2 style="margin:26px 0 10px;font-size:18px">Companies you follow</h2><ul style="padding-left:20px;line-height:1.45">${marketHtml}</ul>`
                : ""
            }
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

export async function sendBriefingEmail(
  recipient: string,
  content: BriefingEmailContent
): Promise<{ message_id: string | null }> {
  const config = getEmailRuntimeConfig();
  const rendered = renderBriefingEmail(content);
  const info = await getTransporter().sendMail({
    from: config.from,
    to: recipient,
    replyTo: config.reply_to || undefined,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    headers: {
      "X-Claritas-Message-Type": "personal-daily-briefing",
    },
  });
  return { message_id: typeof info.messageId === "string" ? info.messageId : null };
}

export async function sendEmailVerificationEmail(recipient: string, verificationUrl: string): Promise<void> {
  const config = getEmailRuntimeConfig();
  const url = safeWebUrl(verificationUrl);
  if (!url) throw new Error("EMAIL_PUBLIC_BASE_URL must be a valid HTTP(S) URL before sending verification email.");
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
