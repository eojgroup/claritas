import test from "node:test";
import assert from "node:assert/strict";
import { extractNewsImageCandidates, newsImageUrl } from "./news-image-metadata";
test("article metadata resolves relative images, deduplicates and excludes logos, ads and unsafe schemes", () => {
  const images = extractNewsImageCandidates(`<meta property="og:image" content="/port.jpg?size=1024&amp;crop=1"><meta property="og:image:alt" content="Ships &amp; cranes">
    <meta name="twitter:image" content="https://publisher.example/port.jpg?size=1024&amp;crop=1">
    <img src="/advert.jpg"><script type="application/ld+json">{"@graph":[{"@type":"Organization","image":"https://publisher.example/logo.png"},{"@type":"NewsArticle","image":{"contentUrl":"/trucks.jpg","caption":"Yard photograph"}}]}</script>
    <meta property="og:image" content="data:image/jpeg;base64,abc">`, "https://publisher.example/article");
  assert.deepEqual(images.map((image)=>image.url),["https://publisher.example/port.jpg?size=1024&crop=1","https://publisher.example/trucks.jpg"]);
  assert.equal(images[0].caption,"Ships & cranes");
  assert.equal(newsImageUrl("https://user:pass@example.com/image"),null);
  assert.equal(newsImageUrl("http://publisher.example/image"),null);
});
test("image metadata harvesting stays bounded", () => {
  const html = Array.from({ length: 20 },(_,index)=>`<meta property="og:image" content="/image${index}.jpg">`).join("");
  assert.equal(extractNewsImageCandidates(html,"https://publisher.example/story").length,4);
});
