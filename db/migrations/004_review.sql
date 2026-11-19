-- Review of a draft: the PDF is out of date after any change until it is created again.
ALTER TABLE mg_editions
  ADD COLUMN pdf_stale TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = changed since the PDF was created' AFTER page_count;

-- Cover photo chosen by hand; NULL = chosen automatically.
ALTER TABLE mg_edition_front_matter
  ADD COLUMN cover_pick_post_id INT NULL AFTER cover_post_id;

-- How an extra image is used when a person overrules the automatic decision; NULL = automatic.
ALTER TABLE mg_asset_cache
  ADD COLUMN manual_kind ENUM('photo','logo','none') NULL AFTER kind_source;
