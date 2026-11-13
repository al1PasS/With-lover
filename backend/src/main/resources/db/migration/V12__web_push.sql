CREATE TABLE web_push_key (
 singleton BOOLEAN PRIMARY KEY CHECK(singleton),
 public_key VARCHAR(128) NOT NULL,
 private_key VARCHAR(128) NOT NULL
);

-- Session FK removes the subscription on logout, credential change or expiry.
CREATE TABLE web_push_subscriptions (
 endpoint VARCHAR(2048) PRIMARY KEY,
 session_primary_id CHAR(36) NOT NULL REFERENCES spring_session(primary_id) ON DELETE CASCADE,
 p256dh VARCHAR(128) NOT NULL,
 auth VARCHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX web_push_session ON web_push_subscriptions(session_primary_id);
