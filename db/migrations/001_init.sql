-- Generator-owned tables. All names are prefixed mg_ so they can also live
-- inside race_news when a separate database is not available.

CREATE TABLE IF NOT EXISTS mg_settings_versions (
  id INT NOT NULL AUTO_INCREMENT,
  settings JSON NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mg_editions (
  id INT NOT NULL AUTO_INCREMENT,
  vertical VARCHAR(40) NOT NULL,
  content_month CHAR(7) NOT NULL COMMENT 'YYYY-MM of the posts',
  edition_label VARCHAR(100) NOT NULL COMMENT 'e.g. November 2026',
  status ENUM('draft','finished') NOT NULL DEFAULT 'draft',
  settings_version_id INT NULL,
  warnings JSON NULL,
  pdf_path VARCHAR(500) NULL,
  cover_path VARCHAR(500) NULL,
  page_count INT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_mg_editions_month (content_month, vertical)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mg_edition_articles (
  id INT NOT NULL AUTO_INCREMENT,
  edition_id INT NOT NULL,
  post_id INT NOT NULL,
  position INT NOT NULL,
  included TINYINT(1) NOT NULL DEFAULT 1,
  section ENUM('national','international') NOT NULL,
  article_type VARCHAR(40) NOT NULL,
  template VARCHAR(40) NULL,
  image_path VARCHAR(500) NULL,
  logo_path VARCHAR(500) NULL,
  snapshot JSON NULL COMMENT 'title and content copied when the edition is finished',
  PRIMARY KEY (id),
  UNIQUE KEY uq_mg_edition_post (edition_id, post_id),
  CONSTRAINT fk_mg_articles_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mg_edition_front_matter (
  edition_id INT NOT NULL,
  cover_source VARCHAR(40) NULL COMMENT 'crop | full | ai-extend | ai-regenerate | upload',
  cover_post_id INT NULL,
  cover_crop JSON NULL,
  cover_line VARCHAR(255) NULL,
  foreword TEXT NULL,
  advert_key VARCHAR(100) NULL,
  PRIMARY KEY (edition_id),
  CONSTRAINT fk_mg_front_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mg_asset_cache (
  id INT NOT NULL AUTO_INCREMENT,
  source_path VARCHAR(500) NOT NULL COMMENT 'path as stored in posts / post_images',
  local_path VARCHAR(500) NULL,
  width INT NULL,
  height INT NULL,
  has_alpha TINYINT(1) NULL,
  kind ENUM('photo','logo','unknown') NOT NULL DEFAULT 'unknown',
  kind_source VARCHAR(20) NULL COMMENT 'measured | ai | manual',
  fetched_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mg_asset_source (source_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
