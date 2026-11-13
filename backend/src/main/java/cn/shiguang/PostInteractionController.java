package cn.shiguang;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/interactions/{module}/{id}")
class PostInteractionController {
    private final JdbcTemplate db;
    private final SiteSettingRepository settings;
    private final PostSettings posts;
    private final ActivityService activities;
    private final AccountRepository accounts;

    PostInteractionController(JdbcTemplate db, SiteSettingRepository settings, PostSettings posts,
                              ActivityService activities, AccountRepository accounts) {
        this.db = db; this.settings = settings; this.posts = posts; this.activities = activities; this.accounts = accounts;
    }

    record Comment(long id, short authorId, String body, Instant createdAt) {}
    record View(boolean liked, int likes, int commentCount, List<Comment> comments, Long nextBefore) {}
    record Like(@NotNull Boolean liked) {}
    record Text(@NotBlank @Size(max = 1000) String body) {}

    @GetMapping
    @Transactional(readOnly = true)
    public View get(@PathVariable String module, @PathVariable String id, @RequestParam(required = false) Long before, Principal principal) {
        target(module, id, false);
        return view(module, id, account(principal), before);
    }

    @PutMapping("/like")
    @Transactional
    public View like(@PathVariable String module, @PathVariable String id, @Valid @RequestBody Like input, Principal principal) {
        String title = target(module, id, true);
        short account = account(principal);
        if (input.liked()) {
            int changed = db.update("INSERT INTO post_likes(module,target_id,account_id) VALUES(?,?,?) ON CONFLICT DO NOTHING", module, id, account);
            if (changed != 0) activities.record(module, id, "liked", title, "点了赞", ActivityService.route(module, id));
        } else db.update("DELETE FROM post_likes WHERE module=? AND target_id=? AND account_id=?", module, id, account);
        return view(module, id, account, null);
    }

    @PostMapping("/comments")
    @Transactional
    public View comment(@PathVariable String module, @PathVariable String id, @Valid @RequestBody Text input, Principal principal) {
        String title = target(module, id, true);
        short account = account(principal);
        db.update("INSERT INTO post_comments(module,target_id,account_id,body) VALUES(?,?,?,?)", module, id, account, input.body().strip());
        activities.record(module, id, "commented", title, "发表了评论", ActivityService.route(module, id));
        return view(module, id, account, null);
    }

    private String target(String module, String id, boolean write) {
        if (!PostSettings.validId(id)) throw missing();
        if (module.equals("memories")) {
            UUID uuid;
            try { uuid = UUID.fromString(id); } catch (IllegalArgumentException e) { throw missing(); }
            if (!uuid.toString().equals(id)) throw missing();
            var titles = db.query("SELECT title FROM memories WHERE id=? AND published AND deleted_at IS NULL" +
                    (write ? " FOR SHARE" : ""), (rs, i) -> rs.getString(1), uuid);
            if (!titles.isEmpty()) return titles.getFirst();
        } else if (module.equals("messages")) {
            if (write) posts.lock(module);
            for (var row : posts.parse(settings.findById(module).map(x -> x.value).orElse("")))
                if (id.equals(row.path("id").asText())) return row.path("title").asText("记录");
        }
        throw missing();
    }

    private short account(Principal principal) {
        return accounts.findByUsername(principal.getName()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED)).id;
    }

    private View view(String module, String id, short account, Long before) {
        int likes = db.queryForObject("SELECT count(*) FROM post_likes WHERE module=? AND target_id=?", Integer.class, module, id);
        boolean liked = db.queryForObject("SELECT EXISTS(SELECT 1 FROM post_likes WHERE module=? AND target_id=? AND account_id=?)", Boolean.class, module, id, account);
        int count = db.queryForObject("SELECT count(*) FROM post_comments WHERE module=? AND target_id=?", Integer.class, module, id);
        var rows = db.query("""
            SELECT id,account_id,body,created_at FROM post_comments WHERE module=? AND target_id=? AND id<?
            ORDER BY id DESC LIMIT 21
            """, (rs, i) -> new Comment(rs.getLong(1), rs.getShort(2), rs.getString(3), rs.getTimestamp(4).toInstant()),
            module, id, before == null ? Long.MAX_VALUE : before);
        return rows.size() > 20 ? new View(liked, likes, count, rows.subList(0,20), rows.get(19).id()) :
            new View(liked, likes, count, rows, null);
    }

    private static ResponseStatusException missing() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "这条记录已删除或不存在"); }
}
