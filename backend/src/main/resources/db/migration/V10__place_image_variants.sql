-- Historical originals stay untouched. Revisions need no image decoding or large-column reads.
ALTER TABLE places ADD COLUMN image_revision UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE places ADD COLUMN image_width INTEGER;
ALTER TABLE places ADD COLUMN image_height INTEGER;
ALTER TABLE places ADD CONSTRAINT places_image_dimensions CHECK (
    (image_width IS NULL AND image_height IS NULL) OR (image_width > 0 AND image_height > 0)
);

CREATE TABLE place_image_variants (
    place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    image_revision UUID NOT NULL,
    width INTEGER NOT NULL CHECK (width > 0 AND width <= 3200),
    height INTEGER NOT NULL CHECK (height > 0),
    content_type VARCHAR(40) NOT NULL CHECK (content_type = 'image/jpeg'),
    etag VARCHAR(80) NOT NULL,
    content BYTEA NOT NULL,
    PRIMARY KEY (place_id, image_revision, width)
);
