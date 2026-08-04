"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOecdRequest = buildOecdRequest;
function buildOecdRequest(api, startPeriod) {
    const url = new URL(api);
    url.searchParams.set("startPeriod", startPeriod);
    url.searchParams.set("dimension_at_observation", "AllDimensions");
    return { url, init: { headers: { accept: "text/csv;version=2.0.0", "accept-language": "en", "user-agent": "Claritas market intelligence/1.0" } } };
}
