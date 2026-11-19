-- How the cover photo is fitted to the tall page, when a person chose it:
-- ai = extended above and below by AI, blur = whole photo on a blurred copy of itself, crop = cropped to fill the page.
-- NULL = the default (ai when an OpenAI key is set).
ALTER TABLE mg_edition_front_matter
  ADD COLUMN cover_style VARCHAR(10) NULL AFTER cover_source;
