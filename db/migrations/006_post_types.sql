-- Article type Claude chose for a post after reading its full text.
-- One row per post, reused by every later preview and generation while the list of types is unchanged.
CREATE TABLE IF NOT EXISTS mg_post_types (
  post_id INT NOT NULL,
  article_type VARCHAR(40) NOT NULL,
  reason VARCHAR(500) NULL,
  model VARCHAR(100) NOT NULL,
  type_set CHAR(40) NOT NULL COMMENT 'fingerprint of the types offered; a changed list means the post is read again',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
