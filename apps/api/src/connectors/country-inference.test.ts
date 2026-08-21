import assert from "node:assert/strict";
import test from "node:test";
import {
  inferIso2FromUrl,
  inferNewsCountry,
  trustedSubjectCountryIso2,
} from "./country-inference";

test("country URL inference accepts ISO country domains but not regional pseudo-codes", () => {
  assert.equal(inferIso2FromUrl("https://example.co.uk/story"), "GB");
  assert.equal(inferIso2FromUrl("https://example.sg/story"), "SG");
  assert.equal(inferIso2FromUrl("https://commission.europa.eu/story"), null);
  assert.equal(inferIso2FromUrl("https://example.eu/story"), null);
});

test("only medium or high content evidence becomes a persisted subject country", () => {
  const feedOnly = inferNewsCountry({
    title: "Quarterly operational update",
    url: "https://publisher.example/news/update",
    feedCountryHint: "GB",
  });
  assert.equal(feedOnly.source, "feed_hint");
  assert.equal(trustedSubjectCountryIso2(feedOnly), null);

  const subject = inferNewsCountry({
    title: "Singapore markets rally after central bank decision",
    url: "https://publisher.example/news/update",
  });
  assert.equal(subject.source, "content_alias");
  assert.equal(trustedSubjectCountryIso2(subject), "SG");

  const weak = inferNewsCountry({
    keywords: ["Singapore"],
    url: "https://publisher.example/news/update",
  });
  assert.equal(weak.confidence, "low");
  assert.equal(trustedSubjectCountryIso2(weak), null);
});
