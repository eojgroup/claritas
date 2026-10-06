-- Content-addressed previews share one analysis across repeated article images.
CREATE TABLE news_image_asset (
  content_hash TEXT PRIMARY KEY CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  preview BYTEA NOT NULL CHECK (octet_length(preview) <= 1000000),
  width INTEGER NOT NULL CHECK (width > 0), height INTEGER NOT NULL CHECK (height > 0),
  analysis JSONB, analysis_model TEXT, prompt_version TEXT,
  analysis_attempts INTEGER NOT NULL DEFAULT 0,
  analysis_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '14 days'
);
CREATE INDEX news_image_asset_pending_idx ON news_image_asset(analysis_after) WHERE analysis IS NULL;
CREATE INDEX news_image_asset_expiry_idx ON news_image_asset(expires_at);
CREATE TABLE news_article_image (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id BIGINT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL REFERENCES news_image_asset(content_hash) ON DELETE CASCADE,
  image_url TEXT NOT NULL, caption TEXT, discovery TEXT NOT NULL,
  publisher TEXT NOT NULL, article_url TEXT NOT NULL,
  license TEXT NOT NULL DEFAULT 'Publisher image; rights not independently verified',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id,content_hash)
);
CREATE INDEX news_article_image_item_idx ON news_article_image(item_id);
CREATE TABLE news_image_discovery (
  item_id BIGINT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_after TIMESTAMPTZ NOT NULL DEFAULT now(), attempts INTEGER NOT NULL DEFAULT 0,
  complete BOOLEAN NOT NULL DEFAULT false, last_error TEXT
);
CREATE TABLE news_image_collection_usage (
  usage_date DATE PRIMARY KEY, article_requests INTEGER NOT NULL DEFAULT 0, vision_requests INTEGER NOT NULL DEFAULT 0
);

-- Reinterpret a bounded set of retained scenes with the new count contract.
INSERT INTO earth_processing_job (dedupe_key,job_type,provider,event_id,location_id,scene_id,observation_id,priority,max_attempts,parameters)
SELECT 'vision:'||observation.id::text||':eo-vision-v2:'||preview.content_hash,'vision_enrichment','openrouter_vision',
       observation.event_id,observation.location_id,observation.scene_id,observation.id,110,2,
       jsonb_build_object('prompt_version','eo-vision-v2','source_asset_type','preview','source_content_hash',preview.content_hash)
FROM earth_observation observation
JOIN earth_observation_asset preview ON preview.observation_id=observation.id AND preview.asset_type='preview'
WHERE observation.status='available' AND observation.captured_at>now()-interval '72 hours'
  AND EXISTS (SELECT 1 FROM earth_observation_asset asset WHERE asset.observation_id=observation.id
              AND asset.asset_type='preview' AND (asset.expires_at IS NULL OR asset.expires_at>now()))
ORDER BY observation.captured_at DESC LIMIT 20
ON CONFLICT (dedupe_key) DO NOTHING;
