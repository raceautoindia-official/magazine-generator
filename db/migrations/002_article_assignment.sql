-- Why each post is in an edition, so the review screen can show it.
ALTER TABLE mg_edition_articles
  ADD COLUMN assigned_by VARCHAR(20) NOT NULL DEFAULT 'category' COMMENT 'category | keyword | general | manual' AFTER article_type,
  ADD COLUMN match_note VARCHAR(500) NULL COMMENT 'reason shown in review' AFTER assigned_by;
