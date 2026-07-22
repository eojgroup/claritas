"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferIso2FromUrl = inferIso2FromUrl;
exports.inferNewsCountry = inferNewsCountry;
const GENERIC_TLDS = new Set([
    "com",
    "net",
    "org",
    "info",
    "biz",
    "edu",
    "gov",
    "mil",
    "int",
    "io",
    "me",
    "tv",
    "news",
    "xyz",
    "online",
    "shop",
    "site",
    "app",
    "tech",
    "cloud",
    "ai",
    "dev",
    "pro",
    "press",
    "co",
    "gg",
]);
const COUNTRY_ALIASES = [
    {
        iso2: "US",
        aliases: [
            "united states",
            "united states of america",
            "usa",
            "u.s.",
            "american",
            "washington",
            "federal reserve",
            "the fed",
            "fed outlook",
            "fed policy",
            "fed rate",
            "fed rates",
            "pentagon",
            "white house",
        ],
    },
    { iso2: "GB", aliases: ["united kingdom", "great britain", "britain", "uk", "british", "england", "london"] },
    { iso2: "FR", aliases: ["france", "french", "paris"] },
    { iso2: "DE", aliases: ["germany", "german", "berlin", "dax"] },
    { iso2: "ES", aliases: ["spain", "spanish", "madrid"] },
    { iso2: "IT", aliases: ["italy", "italian", "rome"] },
    { iso2: "PT", aliases: ["portugal", "portuguese", "lisbon"] },
    { iso2: "IE", aliases: ["ireland", "irish", "dublin"] },
    { iso2: "NL", aliases: ["netherlands", "dutch", "amsterdam"] },
    { iso2: "BE", aliases: ["belgium", "belgian", "brussels"] },
    { iso2: "CH", aliases: ["switzerland", "swiss", "zurich", "geneva"] },
    { iso2: "AT", aliases: ["austria", "austrian", "vienna"] },
    { iso2: "PL", aliases: ["poland", "polish", "warsaw"] },
    { iso2: "CZ", aliases: ["czech republic", "czechia", "prague"] },
    { iso2: "SE", aliases: ["sweden", "swedish", "stockholm"] },
    { iso2: "NO", aliases: ["norway", "norwegian", "oslo"] },
    { iso2: "DK", aliases: ["denmark", "danish", "copenhagen"] },
    { iso2: "FI", aliases: ["finland", "finnish", "helsinki"] },
    { iso2: "RO", aliases: ["romania", "romanian", "bucharest"] },
    { iso2: "HU", aliases: ["hungary", "hungarian", "budapest"] },
    { iso2: "GR", aliases: ["greece", "greek", "athens"] },
    { iso2: "UA", aliases: ["ukraine", "ukrainian", "kyiv", "kiev"] },
    { iso2: "RU", aliases: ["russia", "russian", "moscow", "kremlin"] },
    { iso2: "TR", aliases: ["turkey", "turkish", "ankara", "istanbul"] },
    {
        iso2: "IR",
        aliases: ["iran", "iranian", "tehran", "islamic republic of iran", "strait of hormuz", "hormuz"],
    },
    { iso2: "IQ", aliases: ["iraq", "iraqi", "baghdad"] },
    { iso2: "IL", aliases: ["israel", "israeli", "tel aviv", "jerusalem"] },
    { iso2: "PS", aliases: ["palestine", "palestinian", "gaza", "west bank"] },
    { iso2: "SY", aliases: ["syria", "syrian", "damascus"] },
    { iso2: "LB", aliases: ["lebanon", "lebanese", "beirut"] },
    { iso2: "JO", aliases: ["jordan", "jordanian", "amman"] },
    { iso2: "SA", aliases: ["saudi arabia", "saudi", "riyadh"] },
    { iso2: "AE", aliases: ["united arab emirates", "uae", "emirati", "dubai", "abu dhabi"] },
    { iso2: "QA", aliases: ["qatar", "qatari", "doha"] },
    { iso2: "KW", aliases: ["kuwait", "kuwaiti"] },
    { iso2: "OM", aliases: ["oman", "omani", "muscat"] },
    { iso2: "YE", aliases: ["yemen", "yemeni", "sanaa", "houthi", "houthis"] },
    { iso2: "EG", aliases: ["egypt", "egyptian", "cairo"] },
    { iso2: "MA", aliases: ["morocco", "moroccan", "rabat", "casablanca"] },
    { iso2: "DZ", aliases: ["algeria", "algerian", "algiers"] },
    { iso2: "TN", aliases: ["tunisia", "tunisian", "tunis"] },
    { iso2: "NG", aliases: ["nigeria", "nigerian", "lagos", "abuja"] },
    { iso2: "KE", aliases: ["kenya", "kenyan", "nairobi"] },
    { iso2: "ZA", aliases: ["south africa", "south african", "johannesburg", "cape town"] },
    { iso2: "ET", aliases: ["ethiopia", "ethiopian", "addis ababa"] },
    { iso2: "SD", aliases: ["sudan", "sudanese", "khartoum"] },
    { iso2: "CN", aliases: ["china", "chinese", "beijing"] },
    { iso2: "JP", aliases: ["japan", "japanese", "tokyo"] },
    { iso2: "KR", aliases: ["south korea", "korean", "seoul"] },
    { iso2: "KP", aliases: ["north korea", "dprk", "pyongyang"] },
    { iso2: "IN", aliases: ["india", "indian", "new delhi"] },
    { iso2: "PK", aliases: ["pakistan", "pakistani", "islamabad"] },
    { iso2: "AF", aliases: ["afghanistan", "afghan", "kabul"] },
    { iso2: "BD", aliases: ["bangladesh", "bangladeshi", "dhaka"] },
    { iso2: "TH", aliases: ["thailand", "thai", "bangkok"] },
    { iso2: "MY", aliases: ["malaysia", "malaysian", "kuala lumpur"] },
    { iso2: "SG", aliases: ["singapore", "singaporean"] },
    { iso2: "PH", aliases: ["philippines", "philippine", "filipino", "manila"] },
    { iso2: "VN", aliases: ["vietnam", "vietnamese", "hanoi", "ho chi minh"] },
    { iso2: "ID", aliases: ["indonesia", "indonesian", "jakarta"] },
    { iso2: "TW", aliases: ["taiwan", "taipei"] },
    { iso2: "HK", aliases: ["hong kong"] },
    { iso2: "AU", aliases: ["australia", "australian", "sydney", "melbourne", "canberra"] },
    { iso2: "NZ", aliases: ["new zealand", "kiwi", "wellington", "auckland"] },
    { iso2: "CA", aliases: ["canada", "canadian", "ottawa", "toronto"] },
    { iso2: "MX", aliases: ["mexico", "mexican", "mexico city"] },
    { iso2: "BR", aliases: ["brazil", "brazilian", "brasil", "brasilia", "sao paulo", "rio de janeiro"] },
    { iso2: "AR", aliases: ["argentina", "argentine", "buenos aires"] },
    { iso2: "CL", aliases: ["chile", "chilean", "santiago"] },
    { iso2: "CO", aliases: ["colombia", "colombian", "bogota"] },
    { iso2: "PE", aliases: ["peru", "peruvian", "lima"] },
    { iso2: "VE", aliases: ["venezuela", "venezuelan", "caracas"] },
];
const ALIAS_MATCHERS = COUNTRY_ALIASES.flatMap(({ iso2, aliases }) => aliases.map((alias) => ({
    iso2,
    alias,
    pattern: buildAliasPattern(alias),
})));
function buildAliasPattern(alias) {
    const escaped = escapeRegExp(alias.trim()).replace(/\s+/g, "\\s+");
    return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi");
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeIso2(value) {
    if (!value)
        return null;
    const cleaned = value.trim().toUpperCase();
    if (!cleaned)
        return null;
    if (cleaned === "UK")
        return "GB";
    if (/^[A-Z]{2}$/.test(cleaned))
        return cleaned;
    return null;
}
function countMatches(text, pattern) {
    if (!text)
        return 0;
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}
function extractUrlText(url) {
    if (!url)
        return "";
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/\./g, " ");
        const path = decodeURIComponent(parsed.pathname).replace(/[-_/]+/g, " ");
        return `${host} ${path}`.trim();
    }
    catch {
        return "";
    }
}
function scoreText(text, weight, scores, aliases) {
    if (!text)
        return;
    for (const matcher of ALIAS_MATCHERS) {
        const hitCount = countMatches(text, matcher.pattern);
        if (hitCount <= 0)
            continue;
        const current = scores.get(matcher.iso2) ?? 0;
        scores.set(matcher.iso2, current + hitCount * weight);
        if (!aliases.has(matcher.iso2)) {
            aliases.set(matcher.iso2, matcher.alias);
        }
    }
}
function inferIso2FromUrl(url) {
    if (!url)
        return null;
    try {
        const parsed = new URL(url);
        const host = (parsed.hostname || "").toLowerCase();
        if (!host)
            return null;
        const parts = host.split(".");
        if (parts.length < 2)
            return null;
        const tld = parts[parts.length - 1];
        if (GENERIC_TLDS.has(tld))
            return null;
        if (tld === "uk")
            return "GB";
        const iso2 = tld.toUpperCase();
        return /^[A-Z]{2}$/.test(iso2) ? iso2 : null;
    }
    catch {
        return null;
    }
}
function inferNewsCountry(input) {
    const feedHint = normalizeIso2(input.feedCountryHint);
    const localeHint = normalizeIso2(input.localeHint);
    const urlHint = inferIso2FromUrl(input.url);
    const scores = new Map();
    const matchedAliases = new Map();
    scoreText(input.title ?? "", 5, scores, matchedAliases);
    scoreText(input.summary ?? "", 3, scores, matchedAliases);
    scoreText(input.content ?? "", 1, scores, matchedAliases);
    if (Array.isArray(input.keywords) && input.keywords.length > 0) {
        scoreText(input.keywords.join(" "), 2, scores, matchedAliases);
    }
    scoreText(extractUrlText(input.url), 2, scores, matchedAliases);
    const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    const [best, second] = ranked;
    const bestIso = best?.[0] ?? null;
    const bestScore = best?.[1] ?? 0;
    const secondScore = second?.[1] ?? 0;
    const hasStrongContentSignal = bestIso != null && bestScore >= 3 && bestScore >= secondScore + 1;
    const hasHintAlignedContent = bestIso != null &&
        bestScore >= 3 &&
        (bestIso === feedHint || bestIso === localeHint || bestIso === urlHint);
    if (hasStrongContentSignal || hasHintAlignedContent) {
        return {
            iso2: bestIso,
            source: "content_alias",
            confidence: bestScore >= 6 ? "high" : "medium",
            matched_alias: matchedAliases.get(bestIso) ?? null,
            content_score: bestScore,
            hints: {
                feed: feedHint,
                locale: localeHint,
                url_tld: urlHint,
            },
        };
    }
    if (feedHint) {
        return {
            iso2: feedHint,
            source: "feed_hint",
            confidence: "low",
            matched_alias: null,
            content_score: bestScore,
            hints: {
                feed: feedHint,
                locale: localeHint,
                url_tld: urlHint,
            },
        };
    }
    if (localeHint) {
        return {
            iso2: localeHint,
            source: "locale_hint",
            confidence: "low",
            matched_alias: null,
            content_score: bestScore,
            hints: {
                feed: feedHint,
                locale: localeHint,
                url_tld: urlHint,
            },
        };
    }
    if (urlHint) {
        return {
            iso2: urlHint,
            source: "url_tld",
            confidence: "low",
            matched_alias: null,
            content_score: bestScore,
            hints: {
                feed: feedHint,
                locale: localeHint,
                url_tld: urlHint,
            },
        };
    }
    if (bestIso && bestScore >= 2) {
        return {
            iso2: bestIso,
            source: "content_alias",
            confidence: "low",
            matched_alias: matchedAliases.get(bestIso) ?? null,
            content_score: bestScore,
            hints: {
                feed: feedHint,
                locale: localeHint,
                url_tld: urlHint,
            },
        };
    }
    return {
        iso2: null,
        source: "none",
        confidence: "none",
        matched_alias: null,
        content_score: bestScore,
        hints: {
            feed: feedHint,
            locale: localeHint,
            url_tld: urlHint,
        },
    };
}
