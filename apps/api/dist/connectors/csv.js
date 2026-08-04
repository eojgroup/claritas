"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCsv = parseCsv;
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') {
                field += '"';
                index += 1;
            }
            else {
                quoted = !quoted;
            }
        }
        else if (char === "," && !quoted) {
            row.push(field);
            field = "";
        }
        else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && text[index + 1] === "\n")
                index += 1;
            row.push(field);
            if (row.some((value) => value.length > 0))
                rows.push(row);
            row = [];
            field = "";
        }
        else {
            field += char;
        }
    }
    row.push(field);
    if (row.some((value) => value.length > 0))
        rows.push(row);
    const headers = rows.shift()?.map((value) => value.trim()) ?? [];
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}
