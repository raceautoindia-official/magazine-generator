-- Long work (generating drafts, creating a PDF, painting a cover) runs in the background. The browser starts it,
-- gets this row's id back at once, and asks how it is going; so a slow run can no longer be cut off by the web
-- server's time limit, and pressing the button twice cannot start the same work twice.
CREATE TABLE IF NOT EXISTS mg_jobs (
  id INT NOT NULL AUTO_INCREMENT,
  kind VARCHAR(20) NOT NULL COMMENT 'generate | pdf',
  job_key VARCHAR(190) NOT NULL COMMENT 'what the work is on, e.g. pdf:63 or generate:2026-03:cars,bikes',
  active_key VARCHAR(190) NULL COMMENT 'job_key while the work is running, NULL afterwards: only one running job per key',
  edition_id INT NULL,
  label VARCHAR(160) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'running' COMMENT 'running | done | failed',
  result JSON NULL,
  error TEXT NULL,
  created_by VARCHAR(255) NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mg_jobs_active (active_key),
  KEY idx_mg_jobs_edition (edition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
