"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prioritizeAdsbRouteLookups = prioritizeAdsbRouteLookups;
function stableHash(value) {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
}
function prioritizeAdsbRouteLookups(lookups, limit, generation) {
    if (limit <= 0 || lookups.length === 0)
        return [];
    if (lookups.length <= limit)
        return [...lookups];
    const grouped = new Map();
    for (const lookup of lookups) {
        const scope = lookup.scope.trim().toUpperCase() || "*";
        const group = grouped.get(scope) ?? [];
        group.push(lookup);
        grouped.set(scope, group);
    }
    const ranked = Array.from(grouped, ([scope, group]) => {
        const shuffled = [...group].sort((left, right) => stableHash(`${generation}:${left.callsign}`) -
            stableHash(`${generation}:${right.callsign}`));
        return shuffled.map((lookup, index) => ({
            lookup,
            // Normalizing by group size keeps busy countries proportional while
            // ensuring every observed country enters the selection early.
            rank: index / shuffled.length,
            tieBreaker: stableHash(`${generation}:${scope}:${lookup.callsign}`),
        }));
    })
        .flat()
        .sort((left, right) => left.rank - right.rank || left.tieBreaker - right.tieBreaker);
    return ranked.slice(0, limit).map((entry) => entry.lookup);
}
