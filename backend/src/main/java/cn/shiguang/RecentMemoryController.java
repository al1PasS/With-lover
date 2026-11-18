package cn.shiguang;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
class RecentMemoryController {
    private final JdbcTemplate db;
    private final AlbumImages images;
    private final PrivacyService privacy;

    RecentMemoryController(JdbcTemplate db, AlbumImages images, PrivacyService privacy) {
        this.db = db;
        this.images = images;
        this.privacy = privacy;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Card(UUID id, String title, LocalDate date, String tag, String summary, String thumbnail,
                boolean published, Short authorId, Instant publishedAt) {}

    private static final String ACTIVE = " WHERE m.deleted_at IS NULL";
    private static final String PUBLIC = " AND m.published AND m.public_visible";
    private static final String IMAGE_REVISION = "md5(m.id::text || ':' || m.version::text)";
    private static final String RECENT_FIRST = " ORDER BY m.date DESC, m.updated_at DESC, m.id DESC";

    @GetMapping("/memories/recent")
    List<Card> recent() { return cards(false); }

    @GetMapping("/public/memories/recent")
    List<Card> publicRecent() {
        privacy.requirePublic("home");
        privacy.requirePublic("timeline");
        return cards(true);
    }

    private List<Card> cards(boolean publicly) {
        String excerpt = publicly ? "m.public_summary" : "COALESCE(NULLIF(m.public_summary,''),m.body)";
        String byline = publicly ? "" : ", m.author_id, m.published_at";
        // octet_length(text) can read the stored length without fetching a TOASTed photo.
        String sql = """
            SELECT m.id, m.title, m.date, m.tag, m.published, octet_length(m.image) AS image_size,
                CASE WHEN octet_length(m.image) BETWEEN 1 AND 2048 THEN
                    CASE WHEN m.image ~ '^/images/[A-Za-z0-9_.-]+$' THEN m.image END
                END AS bundled_image,
            """ + "left(" + excerpt + ", 160) AS summary, " + IMAGE_REVISION + " AS revision" + byline
            + " FROM memories m" + ACTIVE + (publicly ? PUBLIC : "") + RECENT_FIRST + " LIMIT 2";
        return db.query(sql, (rs, n) -> {
            UUID id = rs.getObject("id", UUID.class);
            String thumbnail = rs.getString("bundled_image");
            if (thumbnail == null && rs.getInt("image_size") > 0)
                thumbnail = "/api/v1/" + (publicly ? "public/" : "") + "memories/" + id + "/thumbnail?v=" + rs.getString("revision");
            var publishedAt = publicly ? null : rs.getTimestamp("published_at");
            return new Card(id, rs.getString("title"), rs.getObject("date", LocalDate.class), rs.getString("tag"),
                rs.getString("summary"), thumbnail, rs.getBoolean("published"),
                publicly ? null : rs.getObject("author_id", Short.class), publishedAt == null ? null : publishedAt.toInstant());
        });
    }

    @GetMapping("/memories/order")
    List<UUID> order() { return orderedIds(false); }

    @GetMapping("/public/memories/order")
    List<UUID> publicOrder() {
        privacy.requirePublic("timeline");
        return orderedIds(true);
    }

    // The home detail viewer can navigate the same first page as the timeline using IDs alone.
    private List<UUID> orderedIds(boolean publicly) {
        return db.queryForList("SELECT m.id FROM memories m" + ACTIVE + (publicly ? PUBLIC : "")
            + RECENT_FIRST + " LIMIT 24", UUID.class);
    }

    @GetMapping("/memories/{id}/thumbnail")
    ResponseEntity<byte[]> thumbnail(@PathVariable UUID id, @RequestParam(name="v", defaultValue="") String revision) {
        return thumbnail(id, revision, false);
    }

    @GetMapping("/public/memories/{id}/thumbnail")
    ResponseEntity<byte[]> publicThumbnail(@PathVariable UUID id, @RequestParam(name="v", defaultValue="") String revision) {
        privacy.requirePublic("timeline");
        return thumbnail(id, revision, true);
    }

    private record Source(long version, String mime, byte[] cached, String original) {}

    private ResponseEntity<byte[]> thumbnail(UUID id, String revision, boolean publicly) {
        String sql = """
            SELECT m.version, t.mime_type, t.content,
                CASE WHEN t.memory_id IS NULL AND octet_length(m.image) BETWEEN 1 AND 4000000
                     THEN m.image END AS original
            FROM memories m LEFT JOIN memory_card_thumbnails t ON t.memory_id=m.id AND t.memory_version=m.version
            """ + ACTIVE + (publicly ? PUBLIC : "") + " AND m.id=? AND " + IMAGE_REVISION + "=?";
        Source source = db.query(sql, (rs, n) -> new Source(rs.getLong("version"), rs.getString("mime_type"),
            rs.getBytes("content"), rs.getString("original")), id, revision).stream().findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        var thumbnail = source.cached() != null ? new AlbumImages.Thumbnail(source.mime(), source.cached())
            : derive(id, source);
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(MediaType.parseMediaType(thumbnail.mime())).body(thumbnail.content());
    }

    private AlbumImages.Thumbnail derive(UUID id, Source source) {
        String original = source.original();
        if (original == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        int comma = original.indexOf(',');
        if (comma < 0 || !Set.of("data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64",
            "data:image/gif;base64").contains(original.substring(0, comma)))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "配图格式无效");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(original.substring(comma + 1)); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "配图格式无效"); }
        var thumbnail = images.thumbnail(bytes);
        db.update("""
            INSERT INTO memory_card_thumbnails(memory_id, memory_version, mime_type, content)
            SELECT id, version, ?, ? FROM memories WHERE id=? AND version=? AND deleted_at IS NULL
            ON CONFLICT (memory_id) DO UPDATE SET memory_version=EXCLUDED.memory_version,
                mime_type=EXCLUDED.mime_type, content=EXCLUDED.content
            WHERE memory_card_thumbnails.memory_version < EXCLUDED.memory_version
            """, thumbnail.mime(), thumbnail.content(), id, source.version());
        return thumbnail;
    }
}
