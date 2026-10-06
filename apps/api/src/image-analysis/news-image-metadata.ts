export type NewsImageCandidate = { url: string; caption: string | null; discovery: "publisher_metadata" | "feed" };
const decode = (text: string) => text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
  const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
  const code = entity.startsWith("&#x") ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
});
export function newsImageUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(decode(value.trim()), base);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
export function extractNewsImageCandidates(html: string, articleUrl: string): NewsImageCandidate[] {
  const images: NewsImageCandidate[] = [];
  const add = (value: unknown, caption: unknown = null) => {
    const url = newsImageUrl(value, articleUrl);
    if (!url || images.some((image) => image.url === url) || images.length >= 4) return;
    images.push({ url, caption: typeof caption === "string" ? decode(caption).replace(/<[^>]*>/g, "").trim().slice(0, 400) : null, discovery: "publisher_metadata" });
  };
  let caption: string | null = null;
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const match of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1].toLowerCase()] = match[2] ?? match[3];
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key === "og:image:alt" || key === "twitter:image:alt") caption = attrs.content;
    if (["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(key)) add(attrs.content);
  }
  if (caption && images[0]) images[0].caption = decode(caption).replace(/<[^>]*>/g, "").slice(0, 400);
  const visit = (node: unknown, depth = 0) => {
    if (depth > 8 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.slice(0, 30).forEach((value) => visit(value, depth + 1)); return; }
    const value = node as Record<string, unknown>;
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => typeof type === "string" && /^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle)$/.test(type))) {
      const nodes = Array.isArray(value.image) ? value.image : [value.image];
      for (const image of nodes.slice(0, 4)) {
        if (typeof image === "string") add(image);
        else if (image && typeof image === "object") { const imageNode = image as Record<string, unknown>; add(imageNode.contentUrl ?? imageNode.url, imageNode.caption); }
      }
    }
    // Walk wrappers and article graphs, without harvesting logos or page ads.
    for (const [key, child] of Object.entries(value)) if (["@graph", "mainEntity", "itemListElement", "item"].includes(key)) visit(child, depth + 1);
  };
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(script[1])); } catch { /* Optional metadata. */ }
  }
  return images;
}
