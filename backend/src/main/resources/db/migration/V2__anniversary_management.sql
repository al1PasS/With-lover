ALTER TABLE anniversaries ADD COLUMN lunar_month SMALLINT;
ALTER TABLE anniversaries ADD COLUMN lunar_day SMALLINT;
ALTER TABLE anniversaries ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY date, id) - 1 AS new_position
  FROM anniversaries
)
UPDATE anniversaries SET position = ordered.new_position FROM ordered WHERE anniversaries.id = ordered.id;
ALTER TABLE anniversaries ADD CONSTRAINT anniversaries_lunar_date_check CHECK (
  (lunar_month IS NULL AND lunar_day IS NULL) OR
  (lunar_month BETWEEN 1 AND 12 AND lunar_day BETWEEN 1 AND 30)
);
CREATE INDEX anniversaries_position ON anniversaries(position);
