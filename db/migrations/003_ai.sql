-- What Claude found in each photo (kind, where the subject is), kept so every image is looked at once.
ALTER TABLE mg_asset_cache
  ADD COLUMN analysis JSON NULL COMMENT 'kind, subject, focus and subject box from Claude' AFTER kind_source,
  ADD COLUMN analysed_at TIMESTAMP NULL AFTER analysis;

-- Editions Claude chose for shared-category posts that match no edition's words.
-- One row per post, reused by every later preview and generation.
CREATE TABLE IF NOT EXISTS mg_post_placements (
  post_id INT NOT NULL,
  verticals JSON NOT NULL COMMENT 'edition keys; empty array = fits none in particular',
  reason VARCHAR(500) NULL,
  model VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
