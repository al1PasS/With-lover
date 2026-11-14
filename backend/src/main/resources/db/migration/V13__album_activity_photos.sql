ALTER TABLE activity_events
    ADD COLUMN photo_change VARCHAR(10),
    ADD COLUMN photo_ids TEXT[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT activity_album_photo_change CHECK (
        (photo_change IS NULL AND cardinality(photo_ids) = 0)
        OR (photo_change IS NOT NULL AND module = 'albums'
            AND ((photo_change = 'added' AND cardinality(photo_ids) > 0)
                 OR (photo_change = 'cover' AND cardinality(photo_ids) = 1)))
    );
