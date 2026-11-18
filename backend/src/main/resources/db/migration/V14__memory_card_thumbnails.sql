CREATE TABLE memory_card_thumbnails (
    memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
    memory_version BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    content BYTEA NOT NULL
);
