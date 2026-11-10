package cn.shiguang;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Semaphore;

@Service
class MusicService {
    private static final Logger log = LoggerFactory.getLogger(MusicService.class);
    record Track(UUID id, String title, String contentType, long byteSize, String createdAt) {}
    record Limits(long maxFileBytes, int maxTracks, long maxTotalBytes) {}
    record Snapshot(List<Track> tracks, UUID selectedTrackId, long revision, Limits limits) {}
    record PublicMusicSnapshot(UUID selectedTrackId, long revision) {}
    record Content(Resource resource, String contentType, long byteSize) {}
    private record State(UUID selection, long revision) {}
    private record Stored(Track track, String key) {}
    private final JdbcTemplate db;
    private final ActivityService activity;
    private final MusicStorage storage;
    private final MusicValidator validator;
    private final TransactionTemplate writes, reads, cleanup;
    private final Limits limits;
    private final Duration orphanGrace;
    private final Semaphore uploads;

    MusicService(JdbcTemplate db, ActivityService activity, MusicStorage storage, MusicValidator validator,
                 PlatformTransactionManager manager,
                 @Value("${shiguang.music.max-file-bytes:20971520}") long maxFileBytes,
                 @Value("${shiguang.music.max-tracks:20}") int maxTracks,
                 @Value("${shiguang.music.max-total-bytes:209715200}") long maxTotalBytes,
                 @Value("${shiguang.music.max-concurrent-uploads:2}") int concurrentUploads,
                 @Value("${shiguang.music.orphan-grace:PT1H}") Duration orphanGrace) {
        this.db = db; this.activity = activity; this.storage = storage; this.validator = validator;
        if (maxFileBytes <= 0 || maxFileBytes > MusicValidator.HARD_MAX_FILE_BYTES || maxTracks <= 0 || maxTracks > 20
                || maxTotalBytes < maxFileBytes || maxTotalBytes > 200L * 1024 * 1024
                || concurrentUploads < 1 || concurrentUploads > 4 || orphanGrace.compareTo(Duration.ofHours(1)) < 0)
            throw new IllegalArgumentException("Music limits must stay within the supported safety bounds");
        limits = new Limits(maxFileBytes, maxTracks, maxTotalBytes);
        this.orphanGrace = orphanGrace;
        uploads = new Semaphore(concurrentUploads);
        writes = new TransactionTemplate(manager);
        reads = new TransactionTemplate(manager);
        reads.setReadOnly(true);
        reads.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        cleanup = new TransactionTemplate(manager);
        cleanup.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    Snapshot snapshot() { return reads.execute(status -> snapshotInside()); }
    PublicMusicSnapshot publicSnapshot() {
        State state = state(false);
        return new PublicMusicSnapshot(state.selection(), state.revision());
    }
    private State state(boolean lock) {
        return db.queryForObject("SELECT selected_track_id,revision FROM music_state WHERE id=1" + (lock ? " FOR UPDATE" : ""),
                (rs, n) -> new State(rs.getObject(1, UUID.class), rs.getLong(2)));
    }
    private Snapshot snapshotInside() {
        State state = state(false);
        List<Track> tracks = db.query("SELECT * FROM music_tracks ORDER BY created_at DESC,id", (rs, n) -> track(rs));
        return new Snapshot(tracks, state.selection(), state.revision(), limits);
    }
    private static Track track(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Track(rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("content_type"),
                rs.getLong("byte_size"), rs.getTimestamp("created_at").toInstant().toString());
    }
    private Stored stored(UUID id) {
        return db.query("SELECT * FROM music_tracks WHERE id=?", (rs, n) -> new Stored(track(rs), rs.getString("storage_key")), id)
                .stream().findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "音乐不存在或已删除"));
    }
    Snapshot upload(MultipartFile file, String title) {
        if (!uploads.tryAcquire()) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "已有音乐正在上传，请稍后重试");
        try {
            return writes.execute(status -> {
                state(true); // Includes staging: the orphan collector cannot race an unfinished upload on any instance.
                long count = db.queryForObject("SELECT count(*) FROM music_tracks", Long.class);
                long total = db.queryForObject("SELECT COALESCE(sum(byte_size),0) FROM music_tracks", Long.class);
                if (count >= limits.maxTracks()) throw quota();
                Path staged = null;
                try {
                    staged = storage.stage(file, limits.maxFileBytes());
                    long size = Files.size(staged);
                    if (size > limits.maxTotalBytes() - total) throw quota();
                    MusicValidator.Validated validated = validator.validate(staged, file.getOriginalFilename(), file.getContentType(), title);
                    String key = storage.publish(staged);
                    try {
                        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                            @Override public void afterCompletion(int completion) {
                                if (completion != STATUS_COMMITTED) storage.delete(key);
                            }
                        });
                    } catch (RuntimeException ex) {
                        storage.delete(key);
                        throw ex;
                    }
                    String actor = SecurityContextHolder.getContext().getAuthentication().getName();
                    Short account = db.queryForObject("SELECT id FROM accounts WHERE username=?", Short.class, actor);
                    UUID id = UUID.randomUUID();
                    db.update("INSERT INTO music_tracks(id,title,storage_key,content_type,byte_size,uploaded_by) VALUES (?,?,?,?,?,?)",
                            id, validated.title(), key, validated.contentType(), size, account);
                    db.update("UPDATE music_state SET revision=revision+1 WHERE id=1");
                    activity.record("music", id.toString(), "created", validated.title(), "上传了背景音乐", ActivityService.route("music", id.toString()));
                    return snapshotInside();
                } catch (IOException ex) {
                    throw unavailable();
                } finally {
                    if (staged != null) storage.removeQuietly(staged);
                }
            });
        } finally { uploads.release(); }
    }
    Snapshot select(UUID id) {
        return writes.execute(status -> {
            State before = state(true);
            Stored selected = id == null ? null : stored(id);
            if (Objects.equals(before.selection(), id)) return snapshotInside();
            db.update("UPDATE music_state SET selected_track_id=?,revision=revision+1 WHERE id=1", id);
            UUID target = id == null ? before.selection() : id;
            String title = selected == null ? stored(before.selection()).track().title() : selected.track().title();
            activity.record("music", target.toString(), "updated", title,
                    id == null ? "清空了背景音乐选择" : "设为了背景音乐", ActivityService.route("music", target.toString()));
            return snapshotInside();
        });
    }
    Snapshot delete(UUID id) {
        return writes.execute(status -> {
            State before = state(true);
            Stored removed = stored(id);
            db.update("UPDATE music_state SET selected_track_id=?,revision=revision+1 WHERE id=1",
                    Objects.equals(id, before.selection()) ? null : before.selection());
            db.update("DELETE FROM music_tracks WHERE id=?", id);
            activity.record("music", id.toString(), "deleted", removed.track().title(), "删除了背景音乐", ActivityService.route("music", id.toString()));
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { deleteAfterCommit(removed.key()); }
            });
            return snapshotInside();
        });
    }
    private void deleteAfterCommit(String key) {
        // Cleanup must never turn an already committed delete into an apparent failed write.
        try {
            cleanup.executeWithoutResult(status -> {
                state(true);
                if (db.queryForObject("SELECT count(*) FROM music_tracks WHERE storage_key=?", Long.class, key) == 0) storage.delete(key);
            });
        } catch (RuntimeException ex) { log.warn("Committed music deletion awaits orphan cleanup"); }
    }
    Content content(UUID id) { return content(stored(id)); }
    Content publicContent(UUID id) {
        // Recheck the current selection in this query on every GET/HEAD, including every Range request.
        // Never resolve a storage resource for a previously selected or otherwise private library track.
        Stored selected = db.query("""
                SELECT track.* FROM music_tracks track
                JOIN music_state state ON state.selected_track_id=track.id
                WHERE state.id=1 AND track.id=?
                """, (rs, n) -> new Stored(track(rs), rs.getString("storage_key")), id)
                .stream().findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "音乐不存在或已删除"));
        return content(selected);
    }
    private Content content(Stored track) {
        try { return new Content(storage.resource(track.key(), track.track().byteSize()), track.track().contentType(), track.track().byteSize()); }
        catch (IOException ex) { throw unavailable(); }
    }
    void collectOrphans() {
        try {
            cleanup.executeWithoutResult(status -> {
                state(true);
                Set<String> referenced = new HashSet<>(db.queryForList("SELECT storage_key FROM music_tracks", String.class));
                try { storage.collect(referenced, Instant.now().minus(orphanGrace)); }
                catch (IOException ex) { log.warn("Music orphan collection deferred"); }
            });
        } catch (RuntimeException ex) { log.warn("Music orphan collection deferred"); }
    }
    private static ResponseStatusException quota() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "共享曲库已达曲数或总容量限制，请先删除不需要的音乐");
    }
    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "音乐存储暂时不可用，请稍后重试");
    }
}
