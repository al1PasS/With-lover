ALTER TABLE memories ADD COLUMN author_id SMALLINT REFERENCES accounts(id);
ALTER TABLE memories ADD COLUMN published_at TIMESTAMPTZ;
UPDATE memories m SET
 author_id = (SELECT id FROM accounts WHERE username = COALESCE(e.actor, m.author)),
 published_at = CASE WHEN m.published THEN e.created_at END
FROM (
 SELECT m0.id, created.actor, created.created_at FROM memories m0
 LEFT JOIN LATERAL (
  SELECT actor,created_at FROM activity_events
  WHERE module='memories' AND target_id=m0.id::text AND action='created' ORDER BY id LIMIT 1
 ) created ON true
) e WHERE e.id=m.id;

CREATE TABLE post_likes(
 module VARCHAR(16) NOT NULL CHECK(module IN ('memories','messages')),
 target_id VARCHAR(255) NOT NULL,
 account_id SMALLINT NOT NULL REFERENCES accounts(id),
 PRIMARY KEY(module,target_id,account_id)
);
CREATE TABLE post_comments(
 id BIGSERIAL PRIMARY KEY,
 module VARCHAR(16) NOT NULL CHECK(module IN ('memories','messages')),
 target_id VARCHAR(255) NOT NULL,
 account_id SMALLINT NOT NULL REFERENCES accounts(id),
 body VARCHAR(1000) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX post_comments_target ON post_comments(module,target_id,id DESC);

CREATE TABLE album_collections(
 id VARCHAR(255) PRIMARY KEY,
 title VARCHAR(255) NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 category VARCHAR(8) NOT NULL CHECK(category IN ('event','thing')),
 album_date VARCHAR(32) NOT NULL,
 sort_order BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 cover_id VARCHAR(255)
);
CREATE TABLE album_photos(
 album_id VARCHAR(255) NOT NULL REFERENCES album_collections(id) ON DELETE CASCADE,
 id VARCHAR(255) NOT NULL,
 photo_date VARCHAR(32) NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 mime_type VARCHAR(32),
 content BYTEA,
 thumbnail BYTEA,
 static_src TEXT,
 sort_order BIGINT NOT NULL,
 PRIMARY KEY(album_id,id),
 CHECK ((content IS NOT NULL AND mime_type IS NOT NULL) OR static_src IS NOT NULL)
);
CREATE INDEX album_photos_order ON album_photos(album_id,sort_order);

-- Older clients stored either nested collections or a flat photo wall. Preserve the
-- original settings row as a recovery source, and copy only usable raster images.
CREATE FUNCTION pg_temp.album_json(raw text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RETURN raw::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN '[]'::jsonb; END;
$$;
CREATE FUNCTION pg_temp.album_bytes(raw text) RETURNS bytea LANGUAGE plpgsql AS $$
BEGIN RETURN decode(raw,'base64'); EXCEPTION WHEN data_exception THEN RETURN NULL; END;
$$;
CREATE TEMP TABLE legacy_album_rows ON COMMIT DROP AS
WITH input AS (
 SELECT pg_temp.album_json(setting_value) AS data FROM site_settings WHERE setting_key='albums'
), rows AS (
 SELECT node, position
 FROM input CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(data)='array' THEN data ELSE '[]'::jsonb END)
 WITH ORDINALITY AS items(node,position)
)
SELECT node,position FROM rows WHERE jsonb_typeof(node->'photos')='array'
UNION ALL
SELECT jsonb_build_object('id','migrated-'||category,'title',CASE category WHEN 'event' THEN '旧事件照片' ELSE '旧事物照片' END,
 'description','从旧版照片墙自动整理而来。','category',category,'date',min(node->>'date'),'photos',jsonb_agg(node ORDER BY position)),
 min(position)
FROM rows CROSS JOIN (VALUES ('event'),('thing')) types(category)
WHERE node->>'category'=category AND NOT (node ? 'photos') GROUP BY category;

INSERT INTO album_collections(id,title,description,category,album_date,sort_order,created_at)
SELECT node->>'id',left(COALESCE(node->>'title','未命名相册'),255),COALESCE(node->>'description',''),
 CASE WHEN node->>'category'='thing' THEN 'thing' ELSE 'event' END, left(COALESCE(node->>'date',''),32),position,'epoch'
FROM legacy_album_rows
WHERE length(node->>'id') BETWEEN 1 AND 255
ON CONFLICT DO NOTHING;

INSERT INTO album_photos(album_id,id,photo_date,note,mime_type,content,static_src,sort_order)
SELECT c.id,photo->>'id',left(COALESCE(photo->>'date',''),32),COALESCE(photo->>'note',''),
 mime,content,static_src,photo_position
FROM legacy_album_rows r JOIN album_collections c ON c.id=r.node->>'id'
CROSS JOIN LATERAL jsonb_array_elements(r.node->'photos') WITH ORDINALITY AS photos(photo,photo_position)
CROSS JOIN LATERAL (SELECT
 CASE WHEN photo->>'src' ~ '^data:image/(jpeg|png|webp|gif);base64,' THEN split_part(substr(photo->>'src',6),';',1) END AS mime,
 CASE WHEN photo->>'src' ~ '^/images/[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png|gif)$' THEN photo->>'src' END AS static_src
) AS src
CROSS JOIN LATERAL (SELECT CASE WHEN mime IS NOT NULL THEN pg_temp.album_bytes(split_part(photo->>'src',',',2)) END AS content) AS bytes
WHERE length(photo->>'id') BETWEEN 1 AND 255 AND photo->>'id' NOT LIKE 'memory-%'
 AND (octet_length(content)>0 OR static_src IS NOT NULL)
ON CONFLICT DO NOTHING;

UPDATE album_collections c SET cover_id = r.node->>'coverId' FROM legacy_album_rows r
 WHERE c.id=r.node->>'id' AND EXISTS(SELECT 1 FROM album_photos p WHERE p.album_id=c.id AND p.id=r.node->>'coverId');
DELETE FROM album_collections c WHERE (c.id IN ('our-trips','little-favorites') OR c.id LIKE 'migrated-%')
 AND NOT EXISTS(SELECT 1 FROM album_photos p WHERE p.album_id=c.id);

-- Record legacy ownership while the old names can still be matched. Creation
-- activity is authoritative; otherwise use a unique exact name match only.
UPDATE site_settings s
SET setting_value = migrated.rows::text
FROM (
 SELECT original.setting_key, jsonb_agg(
  CASE WHEN jsonb_typeof(item)='object' THEN item
    || CASE WHEN author.id IS NOT NULL THEN jsonb_build_object('authorId',author.id) ELSE '{}'::jsonb END
    || CASE WHEN original.setting_key='messages' AND event.created_at IS NOT NULL THEN jsonb_build_object('publishedAt',event.created_at) ELSE '{}'::jsonb END
   ELSE item END ORDER BY position
 ) AS rows
 FROM site_settings original
 CROSS JOIN LATERAL (SELECT pg_temp.album_json(original.setting_value) AS data) raw
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(raw.data)='array' THEN raw.data ELSE '[]'::jsonb END)
 WITH ORDINALITY AS items(item,position)
 LEFT JOIN LATERAL (
  SELECT e.actor,e.created_at FROM activity_events e
  WHERE e.module=original.setting_key AND e.target_id=item->>'id' AND e.action='created'
  ORDER BY e.id LIMIT 1
 ) event ON true
 LEFT JOIN LATERAL (
  SELECT min(a.id) AS id FROM accounts a
  WHERE a.username=event.actor OR (event.actor IS NULL AND
    (a.username=item->>'author' OR a.nickname=item->>'author'))
  HAVING count(*)=1
 ) author ON true
 WHERE original.setting_key IN ('messages','wishes')
 GROUP BY original.setting_key
) migrated
WHERE s.setting_key=migrated.setting_key;
