-- Which article of an edition each library advert would be printed with, worked out by Claude before the advert
-- is added. Shown as suggestions in the advert picker and reused as the placement when the advert is added.
-- A row is only used while the edition's articles and the advert's description are the ones it was made from.
CREATE TABLE IF NOT EXISTS mg_edition_advert_suggestions (
  edition_id INT NOT NULL,
  advert_id INT NOT NULL,
  article_sig CHAR(40) NOT NULL COMMENT 'sha1 of the included articles the suggestion was made from',
  advert_sig CHAR(40) NOT NULL COMMENT 'sha1 of the advert description and size it was made from',
  choice JSON NOT NULL COMMENT '{articleId, alternatives[], relation, competitor, reason}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (edition_id, advert_id),
  CONSTRAINT fk_mg_adsug_edition FOREIGN KEY (edition_id) REFERENCES mg_editions (id) ON DELETE CASCADE,
  CONSTRAINT fk_mg_adsug_advert FOREIGN KEY (advert_id) REFERENCES mg_adverts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
