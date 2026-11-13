package cn.shiguang;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

@Component
class PostSettings {
    private static final Pattern ID = Pattern.compile("[a-zA-Z0-9_-]{1,255}");
    private final JdbcTemplate db;
    private final ObjectMapper json;

    PostSettings(JdbcTemplate db, ObjectMapper json) { this.db = db; this.json = json; }

    static boolean handles(String key) { return key.equals("messages") || key.equals("wishes"); }
    static boolean validId(String id) { return ID.matcher(id).matches(); }

    // Call in a transaction. Also used to prevent a post from being removed while it receives a comment.
    void lock(String key) {
        db.query("SELECT pg_advisory_xact_lock(hashtext(?),0)", rs -> {}, "shiguang:posts:" + key);
    }

    ArrayNode read(String key, String raw) {
        ArrayNode rows = parse(raw);
        if (rows.isEmpty()) return rows;
        record Original(short account, Instant at) {}
        Map<String, Original> history = new HashMap<>();
        db.query("""
            SELECT DISTINCT ON(e.target_id) e.target_id,a.id,e.created_at
            FROM activity_events e JOIN accounts a ON a.username=e.actor
            WHERE e.module=? AND e.action='created'
            ORDER BY e.target_id,e.id
            """, rs -> {
            history.put(rs.getString(1), new Original(rs.getShort(2), rs.getTimestamp(3).toInstant()));
        }, key);
        for (JsonNode node : rows) {
            if (!(node instanceof ObjectNode row)) continue;
            var original = history.get(row.path("id").asText());
            if (original == null) continue;
            if (!row.hasNonNull("authorId")) row.put("authorId", original.account());
            if (!row.hasNonNull("publishedAt") && key.equals("messages")) row.put("publishedAt", original.at().toString());
        }
        return rows;
    }

    ArrayNode update(String key, ArrayNode previous, String next, short actor) {
        Map<String, JsonNode> old = new HashMap<>();
        for (JsonNode node : previous) old.put(node.path("id").asText(), node);
        ArrayNode rows = parse(next);
        var ids = new java.util.HashSet<String>();
        for (JsonNode node : rows) {
            if (!(node instanceof ObjectNode row)) throw invalid();
            String id = row.path("id").asText();
            if (!validId(id) || !ids.add(id)) throw invalid();
            JsonNode original = old.get(id);
            row.remove(java.util.List.of("authorId", "author", "publishedAt"));
            if (original == null) {
                row.put("authorId", actor);
                if (key.equals("messages")) row.put("publishedAt", Instant.now().toString());
            } else {
                for (String field : java.util.List.of("authorId", "author", "publishedAt"))
                    if (original.has(field)) row.set(field, original.get(field));
            }
        }
        if (key.equals("messages")) {
            for (String id : old.keySet()) if (!ids.contains(id)) {
                db.update("DELETE FROM post_likes WHERE module='messages' AND target_id=?", id);
                db.update("DELETE FROM post_comments WHERE module='messages' AND target_id=?", id);
            }
        }
        return rows;
    }

    ArrayNode parse(String raw) {
        if (raw == null || raw.isBlank()) return json.createArrayNode();
        try {
            if (json.readTree(raw) instanceof ArrayNode rows) return rows;
        } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {}
        throw invalid();
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "内容格式无效");
    }
}
