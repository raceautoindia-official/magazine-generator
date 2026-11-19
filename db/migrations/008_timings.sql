-- How long the application worked on an edition: one row per run (generating the draft,
-- creating the PDF, writing the foreword), with the time of each step inside it.
CREATE TABLE IF NOT EXISTS mg_edition_timings (
  id INT NOT NULL AUTO_INCREMENT,
  edition_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL COMMENT 'generate | pdf | foreword',
  label VARCHAR(120) NOT NULL COMMENT 'what the person did, in words',
  total_ms INT NOT NULL COMMENT 'wall-clock time of the run',
  steps JSON NOT NULL COMMENT '[{name, ms, by: app|claude|openai|site, detail?}]',
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mg_timings_edition (edition_id),
  CONSTRAINT fk_mg_timings_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
