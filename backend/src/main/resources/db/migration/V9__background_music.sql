CREATE TABLE music_tracks (
 id UUID PRIMARY KEY,
 title VARCHAR(120) NOT NULL CHECK (length(trim(title)) > 0),
 storage_key VARCHAR(42) NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.audio$'),
 content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('audio/mpeg','audio/wav')),
 byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
 uploaded_by SMALLINT NOT NULL REFERENCES accounts(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX music_tracks_created ON music_tracks(created_at DESC, id);

-- Every music mutation (including orphan collection) locks this permanent singleton.
CREATE TABLE music_state (
 id SMALLINT PRIMARY KEY CHECK (id = 1),
 selected_track_id UUID REFERENCES music_tracks(id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO music_state(id) VALUES (1);
