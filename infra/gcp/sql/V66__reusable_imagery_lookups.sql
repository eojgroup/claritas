-- Reuse immutable previews without copying bytes or extending their expiry.
-- This also indexes the child side of the asset FK for bounded expiry cleanup.
CREATE INDEX IF NOT EXISTS news_article_image_content_hash_idx
  ON news_article_image(content_hash);
