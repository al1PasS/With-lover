CREATE TABLE activity_events (
 id BIGSERIAL PRIMARY KEY,
 actor VARCHAR(255) NOT NULL,
 module VARCHAR(40) NOT NULL,
 target_id VARCHAR(255) NOT NULL,
 action VARCHAR(40) NOT NULL,
 title VARCHAR(255) NOT NULL,
 summary VARCHAR(500) NOT NULL DEFAULT '',
 route VARCHAR(700) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_events_latest ON activity_events(id DESC);
CREATE INDEX activity_events_target ON activity_events(module, target_id, id DESC);
CREATE TABLE activity_reads (
 account VARCHAR(255) NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
 event_id BIGINT NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
 PRIMARY KEY(account, event_id)
);
