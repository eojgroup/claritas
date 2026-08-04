"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestSecEdgar = ingestSecEdgar;
exports.getMarketFilings = getMarketFilings;
exports.getMarketIndicators = getMarketIndicators;
const world_countries_1 = __importDefault(require("world-countries"));
const db_1 = require("../db");
const SEC_BASE_URL = "https://data.sec.gov";
const SEC_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data";
const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM"];
const DEFAULT_FORMS = ["8-K", "10-K", "10-Q", "20-F", "6-K"];
const FACT_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "NetIncomeLoss",
    "OperatingIncomeLoss",
    "Assets",
    "Liabilities",
    "StockholdersEquity",
    "CashAndCashEquivalentsAtCarryingValue",
    "EarningsPerShareDiluted",
];
const FACT_METRIC_NAMES = {
    RevenueFromContractWithCustomerExcludingAssessedTax: "Revenue",
    Revenues: "Revenue",
    SalesRevenueNet: "Revenue",
    NetIncomeLoss: "Net income",
    OperatingIncomeLoss: "Operating income",
    Assets: "Total assets",
    Liabilities: "Total liabilities",
    StockholdersEquity: "Stockholders' equity",
    CashAndCashEquivalentsAtCarryingValue: "Cash and cash equivalents",
    EarningsPerShareDiluted: "Diluted EPS",
};
let tickerCache = null;
function clampInt(value, min, max, fallback) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), min), max) : fallback;
}
function userAgent() {
    return process.env.SEC_EDGAR_USER_AGENT || "Claritas engineering@claritas.info";
}
async function secFetchJson(url) {
    const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": userAgent() },
    });
    if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        throw new Error(`SEC EDGAR HTTP ${response.status}: ${body}`);
    }
    return (await response.json());
}
async function ensureSource() {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('sec_edgar', $1, 'none', $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url, metadata = EXCLUDED.metadata
     RETURNING id`, [SEC_BASE_URL, JSON.stringify({
            provider: "sec_edgar",
            attribution: "U.S. Securities and Exchange Commission",
            attribution_url: "https://www.sec.gov/edgar",
            access: "public",
            fair_access_requests_per_second: 10,
        })]);
    return rows[0].id;
}
async function ensureUsCountry() {
    const us = world_countries_1.default.find((entry) => entry.cca2 === "US");
    await (0, db_1.query)(`INSERT INTO country (iso2, iso3, name, region, ext)
     VALUES ('US', 'USA', $1, $2, '{}'::jsonb)
     ON CONFLICT (iso2) DO NOTHING`, [us?.name.common ?? "United States", us?.region ?? "Americas"]);
}
async function loadTickerMap() {
    if (tickerCache && tickerCache.expiresAt > Date.now())
        return tickerCache.entries;
    const response = await secFetchJson(SEC_TICKERS_URL);
    const entries = new Map();
    Object.values(response).forEach((entry) => {
        const ticker = entry.ticker?.trim().toUpperCase();
        if (ticker && entry.cik_str)
            entries.set(ticker, entry);
    });
    tickerCache = { expiresAt: Date.now() + 24 * 60 * 60 * 1000, entries };
    return entries;
}
function normalizeSymbols(values) {
    const configured = values && values.length > 0
        ? values
        : (process.env.SEC_EDGAR_SYMBOLS || DEFAULT_SYMBOLS.join(",")).split(",");
    return Array.from(new Set(configured.map((value) => value.trim().toUpperCase()).filter((value) => /^[A-Z0-9.-]{1,12}$/.test(value)))).slice(0, 20);
}
function normalizeForms(values) {
    const source = values && values.length > 0 ? values : DEFAULT_FORMS;
    return Array.from(new Set(source.map((value) => value.trim().toUpperCase()).filter(Boolean))).slice(0, 20);
}
function filingTimestamp(value, fallback) {
    if (value && !Number.isNaN(Date.parse(value)))
        return new Date(value).toISOString();
    if (fallback && /^\d{4}-\d{2}-\d{2}$/.test(fallback))
        return `${fallback}T00:00:00.000Z`;
    return new Date().toISOString();
}
function filingUrl(cik, accession, primaryDocument) {
    const accessionPath = accession.replace(/-/g, "");
    const document = primaryDocument?.trim();
    return document
        ? `${SEC_ARCHIVES_URL}/${cik}/${accessionPath}/${encodeURIComponent(document)}`
        : `${SEC_ARCHIVES_URL}/${cik}/${accessionPath}/`;
}
async function ingestSubmissions(params) {
    const cikPadded = String(params.cik).padStart(10, "0");
    const data = await secFetchJson(`${SEC_BASE_URL}/submissions/CIK${cikPadded}.json`);
    const recent = data.filings?.recent ?? {};
    const accessions = recent.accessionNumber ?? [];
    let inserted = 0;
    let updated = 0;
    let accepted = 0;
    for (let index = 0; index < accessions.length && accepted < params.maxFilings; index += 1) {
        const accession = accessions[index];
        const form = recent.form?.[index]?.toUpperCase();
        if (!accession || !form || !params.forms.has(form))
            continue;
        accepted += 1;
        const eventTime = filingTimestamp(recent.acceptanceDateTime?.[index], recent.filingDate?.[index]);
        const items = recent.items?.[index]?.trim() || null;
        const description = recent.primaryDocDescription?.[index]?.trim() || null;
        const url = filingUrl(params.cik, accession, recent.primaryDocument?.[index]);
        const title = `${params.symbol} ${form} filing`;
        const summaryParts = [description, items ? `Items ${items}` : null, recent.reportDate?.[index] ? `Reporting period ${recent.reportDate[index]}` : null].filter(Boolean);
        const payload = {
            provider: "sec_edgar", accession_number: accession, cik: params.cik,
            form, filing_date: recent.filingDate?.[index] ?? null,
            report_date: recent.reportDate?.[index] ?? null,
            acceptance_datetime: recent.acceptanceDateTime?.[index] ?? null,
            act: recent.act?.[index] ?? null, file_number: recent.fileNumber?.[index] ?? null,
            film_number: recent.filmNumber?.[index] ?? null, items,
            size_bytes: recent.size?.[index] ?? null,
            is_xbrl: recent.isXBRL?.[index] === 1,
            is_inline_xbrl: recent.isInlineXBRL?.[index] === 1,
            primary_document: recent.primaryDocument?.[index] ?? null,
            entity: { name: data.name ?? params.companyName, sic: data.sic ?? null, sic_description: data.sicDescription ?? null, exchanges: data.exchanges ?? [], fiscal_year_end: data.fiscalYearEnd ?? null },
        };
        const result = await (0, db_1.query)(`INSERT INTO market_event (
         source_id, external_id, event_type, symbol, company_name, country_iso2,
         title, summary, url, event_time, payload
       ) VALUES ($1,$2,$3,$4,$5,'US',$6,$7,$8,$9,$10)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         event_type = EXCLUDED.event_type, symbol = EXCLUDED.symbol,
         company_name = EXCLUDED.company_name, title = EXCLUDED.title,
         summary = EXCLUDED.summary, url = EXCLUDED.url, event_time = EXCLUDED.event_time,
         payload = EXCLUDED.payload, updated_at = now()
       RETURNING (xmax = 0) AS inserted`, [params.sourceId, accession, `sec_${form.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
            params.symbol, data.name ?? params.companyName, title, summaryParts.join(" · ") || null,
            url, eventTime, JSON.stringify(payload)]);
        if (result.rows[0]?.inserted)
            inserted += 1;
        else
            updated += 1;
    }
    return { inserted, updated };
}
function selectFactUnits(fact) {
    const out = [];
    for (const [unit, facts] of Object.entries(fact.units ?? {})) {
        if (!Array.isArray(facts))
            continue;
        facts.forEach((entry) => {
            if (typeof entry.val === "number" && Number.isFinite(entry.val) && entry.end && entry.accn)
                out.push({ unit, fact: entry });
        });
    }
    return out
        .filter(({ fact }) => DEFAULT_FORMS.includes((fact.form ?? "").toUpperCase()))
        .sort((a, b) => `${b.fact.end ?? ""}|${b.fact.filed ?? ""}`.localeCompare(`${a.fact.end ?? ""}|${a.fact.filed ?? ""}`));
}
async function ingestCompanyFacts(sourceId, symbol, cik) {
    const cikPadded = String(cik).padStart(10, "0");
    const data = await secFetchJson(`${SEC_BASE_URL}/api/xbrl/companyfacts/CIK${cikPadded}.json`);
    const usGaap = data.facts?.["us-gaap"] ?? {};
    let inserted = 0;
    let updated = 0;
    const seenMetricPeriods = new Set();
    for (const concept of FACT_CONCEPTS) {
        const fact = usGaap[concept];
        if (!fact)
            continue;
        const metricName = FACT_METRIC_NAMES[concept] ?? fact.label ?? concept;
        for (const { unit, fact: observation } of selectFactUnits(fact)) {
            const periodKey = `${metricName}|${observation.end}|${observation.fp ?? ""}`;
            if (seenMetricPeriods.has(periodKey))
                continue;
            seenMetricPeriods.add(periodKey);
            if (seenMetricPeriods.size > 80)
                break;
            const externalId = `${symbol}:${concept}:${observation.accn}:${observation.end}:${observation.fp ?? ""}`;
            const observedAt = observation.filed && /^\d{4}-\d{2}-\d{2}$/.test(observation.filed)
                ? `${observation.filed}T00:00:00.000Z`
                : new Date().toISOString();
            const payload = {
                provider: "sec_edgar", taxonomy: "us-gaap", concept,
                label: fact.label ?? null, description: fact.description ?? null,
                accession_number: observation.accn, fiscal_year: observation.fy ?? null,
                fiscal_period: observation.fp ?? null, form: observation.form ?? null,
                filed: observation.filed ?? null, frame: observation.frame ?? null, cik,
            };
            const result = await (0, db_1.query)(`INSERT INTO market_indicator (
           source_id, external_id, category, series_key, symbol, country_iso2,
           name, unit, frequency, period_start, period_end, value, observed_at, payload
         ) VALUES ($1,$2,'company_fundamental',$3,$4,'US',$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (source_id, external_id) DO UPDATE SET
           value = EXCLUDED.value, observed_at = EXCLUDED.observed_at,
           payload = EXCLUDED.payload, updated_at = now()
         RETURNING (xmax = 0) AS inserted`, [sourceId, externalId, `SEC:${symbol}:${concept}`, symbol, metricName, unit,
                observation.fp ?? null, observation.start ?? null, observation.end,
                observation.val, observedAt, JSON.stringify(payload)]);
            if (result.rows[0]?.inserted)
                inserted += 1;
            else
                updated += 1;
        }
    }
    return { inserted, updated };
}
async function ingestSecEdgar(params = {}) {
    await ensureUsCountry();
    const sourceId = await ensureSource();
    const tickerMap = await loadTickerMap();
    const symbols = normalizeSymbols(params.symbols);
    const forms = new Set(normalizeForms(params.forms));
    const maxFilings = clampInt(params.maxFilingsPerCompany, 1, 100, 20);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const companies = [];
    for (const symbol of symbols) {
        const company = tickerMap.get(symbol);
        if (!company?.cik_str) {
            skipped += 1;
            companies.push({ symbol, error: "Ticker not found in SEC company_tickers.json" });
            continue;
        }
        try {
            const filings = await ingestSubmissions({
                sourceId, symbol, cik: company.cik_str, companyName: company.title ?? symbol,
                forms, maxFilings,
            });
            inserted += filings.inserted;
            updated += filings.updated;
            let facts = { inserted: 0, updated: 0 };
            if (params.includeCompanyFacts !== false) {
                facts = await ingestCompanyFacts(sourceId, symbol, company.cik_str);
                inserted += facts.inserted;
                updated += facts.updated;
            }
            companies.push({ symbol, cik: company.cik_str, filings, facts });
        }
        catch (error) {
            skipped += 1;
            companies.push({ symbol, cik: company.cik_str, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { provider: "sec_edgar", inserted, updated, skipped, symbols, forms: Array.from(forms), companies };
}
async function getMarketFilings(params = {}) {
    const symbol = params.symbol?.trim().toUpperCase() || "";
    const forms = normalizeForms(params.forms);
    const eventTypes = forms.map((form) => `sec_${form.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
    const limit = clampInt(params.limit, 1, 500, 100);
    const { rows } = await (0, db_1.query)(`SELECT me.id, me.event_type, me.symbol, me.company_name,
            me.country_iso2 AS country, me.title, me.summary, me.url,
            me.event_time, s.name AS source_name, me.payload
     FROM market_event me JOIN source s ON s.id = me.source_id
     WHERE ($1::text = '' OR me.symbol = $1)
       AND (cardinality($2::text[]) = 0 OR me.event_type = ANY($2::text[]))
     ORDER BY me.event_time DESC LIMIT $3`, [symbol, eventTypes, limit]);
    return rows;
}
async function getMarketIndicators(params = {}) {
    const category = params.category?.trim() || "";
    const symbol = params.symbol?.trim().toUpperCase() || "";
    const series = params.series?.trim() || "";
    const limit = clampInt(params.limit, 1, 1000, 200);
    const { rows } = await (0, db_1.query)(`SELECT mi.id, mi.category, mi.series_key, mi.symbol, mi.country_iso2 AS country,
            mi.name, mi.unit, mi.frequency, mi.period_start, mi.period_end,
            mi.value, mi.observed_at, s.name AS source_name, mi.payload
     FROM market_indicator mi JOIN source s ON s.id = mi.source_id
     WHERE ($1::text = '' OR mi.category = $1)
       AND ($2::text = '' OR mi.symbol = $2)
       AND ($3::text = '' OR mi.series_key = $3)
     ORDER BY mi.period_end DESC, mi.observed_at DESC LIMIT $4`, [category, symbol, series, limit]);
    return rows;
}
