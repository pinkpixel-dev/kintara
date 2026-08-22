-- Per-user image model selection for AI cover generation.
--
-- Separate columns from the text models rather than a shared one: the two
-- catalogues do not overlap, and a reader who wants a cheap image model with a
-- capable text model should not have to choose between them.

ALTER TABLE user_ai_settings ADD COLUMN openai_image_model TEXT;
ALTER TABLE user_ai_settings ADD COLUMN google_image_model TEXT;
