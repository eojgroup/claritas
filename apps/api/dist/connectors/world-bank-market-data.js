"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORLD_BANK_INDICATORS = void 0;
exports.parseWorldBankResponse = parseWorldBankResponse;
exports.WORLD_BANK_INDICATORS = [
    { code: "NY.GDP.MKTP.KD.ZG", shortName: "GDP growth", unit: "% annual", valueSemantics: "rate", priority: 10 },
    { code: "FP.CPI.TOTL.ZG", shortName: "Inflation", unit: "% annual", valueSemantics: "rate", priority: 20 },
    { code: "SL.UEM.TOTL.ZS", shortName: "Unemployment", unit: "% labour force", valueSemantics: "rate", priority: 30 },
    { code: "BN.CAB.XOKA.GD.ZS", shortName: "Current account", unit: "% GDP", valueSemantics: "rate", priority: 40 },
];
function parseWorldBankResponse(payload) {
    if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[1])) {
        return { lastUpdated: null, observations: [] };
    }
    const metadata = payload[0] && typeof payload[0] === "object" ? payload[0] : {};
    const observations = payload[1].flatMap((row) => {
        const indicatorCode = typeof row?.indicator?.id === "string" ? row.indicator.id : "";
        const indicatorName = typeof row?.indicator?.value === "string" ? row.indicator.value : indicatorCode;
        const countryIso3 = typeof row?.countryiso3code === "string" ? row.countryiso3code.toUpperCase() : "";
        const countryName = typeof row?.country?.value === "string" ? row.country.value : countryIso3;
        const year = Number(row?.date);
        const value = row?.value == null ? Number.NaN : Number(row.value);
        if (!indicatorCode || !/^[A-Z]{3}$/.test(countryIso3) || !Number.isInteger(year) || year < 1900 || !Number.isFinite(value))
            return [];
        return [{
                indicatorCode, indicatorName, countryIso3, countryName, year, value,
                observationStatus: typeof row?.obs_status === "string" && row.obs_status ? row.obs_status : null,
            }];
    });
    return {
        lastUpdated: typeof metadata.lastupdated === "string" ? metadata.lastupdated : null,
        observations,
    };
}
