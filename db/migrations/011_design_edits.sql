-- Changes made on the Design tab. They belong to one edition; the website's posts are never changed.

-- How a picture sits in its frame, and which picture it is.
-- frame: 'cover', or 'a<article row id>:spread | photo | tail | band'.
CREATE TABLE IF NOT EXISTS mg_edition_frames (
  edition_id INT NOT NULL,
  frame VARCHAR(40) NOT NULL,
  source VARCHAR(600) NULL COMMENT 'NULL = the automatic picture; post:<stored path> or upload:<id>',
  x DOUBLE NULL COMMENT '0 = the left edge of the picture shows, 1 = the right edge; NULL = automatic',
  y DOUBLE NULL COMMENT '0 = top, 1 = bottom',
  zoom DOUBLE NULL COMMENT '1 = the picture just fills the frame',
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (edition_id, frame),
  CONSTRAINT fk_mg_frames_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- An article's headline and text as edited for this edition.
CREATE TABLE IF NOT EXISTS mg_edition_texts (
  article_id INT NOT NULL COMMENT 'mg_edition_articles.id',
  edition_id INT NOT NULL,
  title VARCHAR(500) NULL COMMENT 'NULL = the post''s own headline',
  paragraphs JSON NULL COMMENT 'NULL = the post''s own text; else paragraphs of HTML with strong, em, sup, sub only',
  base_hash CHAR(40) NOT NULL COMMENT 'sha1 of the website''s headline and text when this edit was made',
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id),
  KEY idx_mg_texts_edition (edition_id),
  CONSTRAINT fk_mg_texts_article FOREIGN KEY (article_id) REFERENCES mg_edition_articles (id) ON DELETE CASCADE,
  CONSTRAINT fk_mg_texts_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pictures uploaded for one edition, to replace a post's picture in a frame.
CREATE TABLE IF NOT EXISTS mg_edition_uploads (
  id INT NOT NULL AUTO_INCREMENT,
  edition_id INT NOT NULL,
  original_name VARCHAR(255) NOT NULL DEFAULT '',
  width INT NOT NULL,
  height INT NOT NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mg_uploads_edition (edition_id),
  CONSTRAINT fk_mg_uploads_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
