-- Article types became a list kept in Settings; the two old fixed types get their new keys.
UPDATE mg_edition_articles SET article_type = 'vehicle-launch' WHERE article_type = 'launch';
UPDATE mg_edition_articles SET article_type = 'managerial-changes' WHERE article_type = 'management';
