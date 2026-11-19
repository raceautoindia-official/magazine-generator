-- Adverts: a library of uploaded adverts, and where each one is printed in an edition.
CREATE TABLE IF NOT EXISTS mg_adverts (
  id INT NOT NULL AUTO_INCREMENT,
  advertiser VARCHAR(160) NOT NULL DEFAULT '',
  size VARCHAR(10) NOT NULL COMMENT 'double | full | half | quarter',
  fit VARCHAR(10) NOT NULL DEFAULT 'crop' COMMENT 'crop = fill the space, whole = show all of it on a plain border',
  keep VARCHAR(10) NOT NULL DEFAULT 'centre' COMMENT 'part kept when cropping: centre | top | bottom | left | right',
  original_name VARCHAR(255) NOT NULL DEFAULT '',
  width INT NOT NULL COMMENT 'of the uploaded picture, in pixels',
  height INT NOT NULL,
  link VARCHAR(500) NULL COMMENT 'advertiser web address, kept for clickable adverts later',
  summary TEXT NULL COMMENT 'what the advert is for; written by Claude, can be corrected by a person',
  analysis JSON NULL COMMENT '{product, segments[], keywords[]} from Claude',
  summary_by VARCHAR(10) NULL COMMENT 'claude | person',
  archived TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = no longer offered for new editions',
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mg_edition_adverts (
  id INT NOT NULL AUTO_INCREMENT,
  edition_id INT NOT NULL,
  advert_id INT NOT NULL,
  article_id INT NULL COMMENT 'mg_edition_articles.id the advert is printed with; NULL = needs placing again',
  reason VARCHAR(700) NOT NULL DEFAULT '' COMMENT 'why it is there, shown on the Articles tab',
  placed_by VARCHAR(10) NOT NULL DEFAULT 'rule' COMMENT 'claude | rule | person',
  warning VARCHAR(400) NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mg_edition_advert (edition_id, advert_id),
  CONSTRAINT fk_mg_edadv_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE,
  CONSTRAINT fk_mg_edadv_advert FOREIGN KEY (advert_id) REFERENCES mg_adverts (id),
  CONSTRAINT fk_mg_edadv_article FOREIGN KEY (article_id) REFERENCES mg_edition_articles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
