import crypto from "node:crypto";
import { query, withTransaction } from "./db";
import { createLlmClientFromEnv } from "./llm";

type SegmentRow = {
  id: number;
  segment_index: number;
  start_ms: number;
  end_ms: number | null;
  speaker: string | null;
  text: string;
};

type EpisodeRow = {
  title: string | null;
  summary: string | null;
  feed_title: string;
};

type Person = { name?: string | null; role?: string | null; group?: string | null; href?: string | null };

type ExtractedSignal = {
  type?: unknown;
  title?: unknown;
  summary?: unknown;
  entities?: unknown;
  topics?: unknown;
  risk_level?: unknown;
  confidence?: unknown;
  evidence_segment_indexes?: unknown;
};

type ExtractionOutput = { signals?: unknown };

const SIGNAL_TYPES = new Set(["entity", "topic", "claim", "event", "risk"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    signals: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["entity", "topic", "claim", "event", "risk"] },
          title: { type: "string" },
          summary: { type: "string" },
          entities: { type: "array", items: { type: "string" } },
          topics: { type: "array", items: { type: "string" } },
          risk_level: { type: ["string", "null"], enum: ["low", "medium", "high", "critical", null] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence_segment_indexes: { type: "array", items: { type: "integer", minimum: 0 }, maxItems: 6 },
        },
        required: ["type", "title", "summary", "entities", "topics", "risk_level", "confidence", "evidence_segment_indexes"],
      },
    },
  },
  required: ["signals"],
};

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function cleanList(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => clean(item, 160)).filter((item): item is string => Boolean(item)))).slice(0, maxItems);
}

function canonicalKey(value: string): string {
  const normalized = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 160);
  return normalized || crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function extractionEnabled(): boolean {
  const configured = Boolean(process.env.OPENCODE_SERVER_URL?.trim());
  const raw = process.env.PODCAST_INTELLIGENCE_EXTRACTION_ENABLED?.trim().toLowerCase();
  if (!raw) return configured;
  return !["0", "false", "no", "off"].includes(raw);
}

function normalizeSignal(raw: ExtractedSignal) {
  const type = clean(raw.type, 20)?.toLowerCase();
  const title = clean(raw.title, 300);
  if (!type || !SIGNAL_TYPES.has(type) || !title) return null;
  const risk = clean(raw.risk_level, 20)?.toLowerCase() || null;
  const numericConfidence = Number(raw.confidence);
  const evidence = Array.isArray(raw.evidence_segment_indexes)
    ? Array.from(new Set(raw.evidence_segment_indexes.map(Number).filter((value) => Number.isSafeInteger(value) && value >= 0))).slice(0, 6)
    : [];
  return {
    type,
    title,
    summary: clean(raw.summary, 1200),
    entities: cleanList(raw.entities),
    topics: cleanList(raw.topics),
    risk_level: risk && RISK_LEVELS.has(risk) ? risk : null,
    confidence: Number.isFinite(numericConfidence) ? Math.min(Math.max(numericConfidence, 0), 1) : null,
    evidence,
    method: "llm",
  };
}

function metadataSignals(persons: Person[], categories: Record<string, string>) {
  const entitySignals = persons.flatMap((person) => {
    const name = clean(person.name, 200);
    if (!name) return [];
    const role = clean(person.role, 120);
    return [{
      type: "entity", title: name,
      summary: role ? `${name} is identified by the publisher as ${role}.` : `${name} is identified by the publisher as an episode participant.`,
      entities: [name], topics: role ? [role] : [], risk_level: null, confidence: 1,
      evidence: [] as number[], method: "podcast:person",
      metadata: { role, group: clean(person.group, 120), href: clean(person.href, 500) },
    }];
  });
  const topicSignals = Object.values(categories || {}).flatMap((category) => {
    const topic = clean(category, 200);
    if (!topic) return [];
    return [{
      type: "topic", title: topic, summary: "Topic assigned in the source podcast feed metadata.",
      entities: [] as string[], topics: [topic], risk_level: null, confidence: 0.8,
      evidence: [] as number[], method: "podcast:category", metadata: {},
    }];
  });
  return [...entitySignals, ...topicSignals];
}

async function runLlmExtraction(episode: EpisodeRow, segments: SegmentRow[]) {
  if (!extractionEnabled() || segments.length === 0) return [];
  const evidence = segments.slice(0, 120).map((segment) => ({
    index: segment.segment_index,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    speaker: segment.speaker,
    text: segment.text.slice(0, 1600),
  }));
  const response = await createLlmClientFromEnv().generateStructured<ExtractionOutput>({
    title: `Podcast intelligence: ${episode.title || episode.feed_title}`,
    system: [
      "Extract intelligence signals from timestamped podcast transcript evidence.",
      "Use only supplied evidence. Do not infer unsupported facts or copy promotional claims as fact.",
      "Claims are attributed statements; events are concrete occurrences; risks are potential adverse outcomes.",
      "Return evidence segment indexes that directly support every claim, event, or risk.",
      "Keep titles and summaries neutral, concise, and useful for entity dossiers, alerts, briefs, and search.",
    ].join(" "),
    prompt: JSON.stringify({ episode, evidence }),
    schema: OUTPUT_SCHEMA,
    retryCount: 1,
  });
  const signals = Array.isArray(response.output?.signals) ? response.output.signals : [];
  return signals.map((signal) => normalizeSignal(signal as ExtractedSignal)).filter((signal): signal is NonNullable<ReturnType<typeof normalizeSignal>> => Boolean(signal));
}

export async function extractPodcastIntelligence(
  episodeId: number,
  persons: Person[],
  categories: Record<string, string>
): Promise<number> {
  const [episodeResult, segmentResult] = await Promise.all([
    query<EpisodeRow>(
      `SELECT i.title, i.summary, pf.title AS feed_title
       FROM podcast_episode pe
       JOIN item i ON i.id = pe.item_id
       JOIN podcast_feed pf ON pf.id = pe.feed_id
       WHERE pe.id = $1`,
      [episodeId]
    ),
    query<SegmentRow>(
      `SELECT id, segment_index, start_ms, end_ms, speaker, text
       FROM evidence_segment WHERE episode_id = $1 ORDER BY segment_index ASC`,
      [episodeId]
    ),
  ]);
  const episode = episodeResult.rows[0];
  if (!episode) return 0;
  const segments = segmentResult.rows;
  const signalInputs: Array<Record<string, unknown>> = [...metadataSignals(persons, categories)];
  let extractionError: string | null = null;
  try {
    signalInputs.push(...await runLlmExtraction(episode, segments));
  } catch (error) {
    extractionError = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  }

  const segmentByIndex = new Map(segments.map((segment) => [segment.segment_index, segment]));
  let stored = 0;
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM intelligence_signal WHERE episode_id = $1`, [episodeId]);
    for (const raw of signalInputs) {
      const type = clean(raw.type, 20)?.toLowerCase();
      const title = clean(raw.title, 300);
      if (!type || !SIGNAL_TYPES.has(type) || !title) continue;
      const entities = cleanList(raw.entities);
      const topics = cleanList(raw.topics);
      const risk = clean(raw.risk_level, 20)?.toLowerCase() || null;
      const confidenceValue = Number(raw.confidence);
      const confidence = Number.isFinite(confidenceValue) ? Math.min(Math.max(confidenceValue, 0), 1) : null;
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO intelligence_signal (
           episode_id, signal_type, title, summary, canonical_key, entities, topics,
           risk_level, confidence, extraction_method, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (episode_id, signal_type, canonical_key) DO UPDATE SET
           title = EXCLUDED.title, summary = EXCLUDED.summary,
           entities = EXCLUDED.entities, topics = EXCLUDED.topics,
           risk_level = EXCLUDED.risk_level, confidence = EXCLUDED.confidence,
           extraction_method = EXCLUDED.extraction_method, metadata = EXCLUDED.metadata,
           updated_at = now()
         RETURNING id`,
        [
          episodeId, type, title, clean(raw.summary, 1200), canonicalKey(title),
          JSON.stringify(entities), JSON.stringify(topics),
          risk && RISK_LEVELS.has(risk) ? risk : null, confidence,
          clean(raw.method, 80) || "metadata", JSON.stringify(raw.metadata || {}),
        ]
      );
      stored += 1;
      const evidenceIndexes = Array.isArray(raw.evidence) ? raw.evidence.map(Number) : [];
      for (const index of evidenceIndexes) {
        const segment = segmentByIndex.get(index);
        if (!segment) continue;
        await client.query(
          `INSERT INTO intelligence_signal_evidence (signal_id, evidence_segment_id, relevance, quote)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (signal_id, evidence_segment_id) DO UPDATE SET relevance = EXCLUDED.relevance, quote = EXCLUDED.quote`,
          [inserted.rows[0].id, segment.id, confidence, segment.text.slice(0, 800)]
        );
      }
    }
    await client.query(
      `UPDATE podcast_episode
       SET processed_at = now(),
           metadata = CASE
             WHEN $2::text IS NULL THEN metadata - 'extraction_error'
             ELSE metadata || jsonb_build_object('extraction_error', $2::text)
           END,
           updated_at = now()
       WHERE id = $1`,
      [episodeId, extractionError]
    );
  });
  return stored;
}
