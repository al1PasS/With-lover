package cn.shiguang;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "ACTIVITY_DB_TEST", matches = "true")
class MusicIntegrationTest {
    private static final Path MEDIA = tempMedia();
    private static Path tempMedia() {
        try { return Files.createTempDirectory("shiguang-music-db-test-"); }
        catch (IOException ex) { throw new java.io.UncheckedIOException(ex); }
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("shiguang.media-root", MEDIA::toString);
    }
    @Autowired MusicService music;
    @Autowired MusicStorage storage;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired TransactionTemplate transactions;
    @Autowired ActivityService activity;
    @BeforeEach void seed() throws Exception {
        // This class is deliberately not transactional: exercise real commit/rollback filesystem callbacks.
        db.update("UPDATE music_state SET selected_track_id=NULL,revision=0 WHERE id=1");
        db.update("DELETE FROM music_tracks");
        db.update("DELETE FROM activity_events WHERE module='music'");
        db.update("INSERT INTO accounts(id,username,password,nickname,role) VALUES (1,'activity-one','unused','测试甲','ADMIN'),(2,'activity-two','unused','测试乙','MEMBER') ON CONFLICT DO NOTHING");
        Files.createDirectories(storage.directory());
        try (var files = Files.list(storage.directory())) { for (Path path : files.toList()) Files.delete(path); }
        as("activity-one");
    }
    @AfterEach void clear() { SecurityContextHolder.clearContext(); }
    @AfterAll static void removeMedia() throws IOException {
        try (var files = Files.walk(MEDIA)) { for (Path path : files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path); }
    }
    private static void as(String name) {
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(name, null, List.of()));
    }
    private MockMultipartFile wav(String title) { return new MockMultipartFile("file", title+".wav", "audio/wav", MusicFixtures.wav()); }
    private UUID upload(String title) { return music.upload(wav(title), title).tracks().stream().filter(t -> t.title().equals(title)).findFirst().orElseThrow().id(); }
    private long files() throws IOException { try (var files = Files.list(storage.directory())) { return files.count(); } }
    private long events() { return db.queryForObject("SELECT count(*) FROM activity_events WHERE module='music'", Long.class); }
    @Test void bothAccountsShareSelectionAndDeletingCurrentDoesNotSelectAnother() throws Exception {
        UUID first = upload("第一首");
        assertNull(music.snapshot().selectedTrackId());
        assertEquals(1, music.snapshot().revision());
        assertEquals(1, db.queryForObject("SELECT uploaded_by FROM music_tracks WHERE id=?", Integer.class,first));
        as("activity-two"); UUID second = upload("第二首");
        var selected = music.select(first); assertEquals(first, selected.selectedTrackId()); assertEquals(3,selected.revision());
        assertEquals(3, events());
        music.select(first); assertEquals(3, events()); assertEquals(3,music.snapshot().revision());
        var feed = activity.feed("activity-two", true, null);
        var event = feed.items().stream().filter(x -> x.module().equals("music")).findFirst().orElseThrow();
        assertEquals("/admin?activity="+first,event.route()); assertEquals("设为了背景音乐",event.summary());
        var deleted = music.delete(first); assertNull(deleted.selectedTrackId()); assertEquals(4,deleted.revision());
        assertEquals(List.of(second),deleted.tracks().stream().map(MusicService.Track::id).toList());
        assertEquals(1,files());
        assertTrue(activity.feed("activity-one",true,null).items().stream().filter(x -> x.targetId().equals(first.toString())).allMatch(ActivityService.Item::deleted));
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> music.select(first));
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> music.content(first));
    }
    @Test void clearingSelectionIsIdempotentAndTransactional() {
        UUID id = upload("清空"); music.select(id);
        var empty = music.select(null); assertNull(empty.selectedTrackId()); assertEquals(3,empty.revision());
        music.select(null); assertEquals(3,events()); assertEquals(3,music.snapshot().revision());
    }
    @Test void rollbackRemovesNewFilesAndRetainsMetadataAndActivityAtomicity() throws Exception {
        assertThrows(IllegalStateException.class, () -> transactions.execute(status -> {
            upload("回滚"); assertEquals(1,db.queryForObject("SELECT count(*) FROM music_tracks",Integer.class));
            throw new IllegalStateException("forced rollback");
        }));
        assertEquals(0,files()); assertEquals(0,events()); assertEquals(0,music.snapshot().revision());
        assertTrue(music.snapshot().tracks().isEmpty());
        UUID id = upload("保留"); music.select(id);
        assertThrows(IllegalStateException.class, () -> transactions.execute(status -> { music.delete(id); throw new IllegalStateException("rollback deletion"); }));
        assertEquals(id,music.snapshot().selectedTrackId()); assertEquals(1,files()); assertEquals(2,events());
    }
    @Test void activityFailureRollsBackPublishedFileAndMetadata() throws Exception {
        db.execute("ALTER TABLE activity_events ADD CONSTRAINT music_test_reject CHECK (module <> 'music') NOT VALID");
        try { assertThrows(RuntimeException.class, () -> upload("失败")); }
        finally { db.execute("ALTER TABLE activity_events DROP CONSTRAINT music_test_reject"); }
        assertEquals(0,files()); assertEquals(0,music.snapshot().revision()); assertTrue(music.snapshot().tracks().isEmpty());
    }
    @Test void invalidUploadLeavesNoFilesOrRows() throws Exception {
        assertThrows(RuntimeException.class, () -> music.upload(new MockMultipartFile("file","bad.mp3","audio/mpeg",new byte[]{1,2,3}),null));
        assertEquals(0,files()); assertEquals(0,events()); assertTrue(music.snapshot().tracks().isEmpty());
    }
    @Test void singletonLockSerializesCapacityChecksAndConcurrentMutations() throws Exception {
        for (int i=0;i<19;i++) upload("填充"+i);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<Boolean>> futures = new ArrayList<>();
            for(int i=0;i<2;i++) {
                int index=i;
                futures.add(pool.submit(() -> { as("activity-two"); start.await(); try { upload("并发"+index); return true; }
                    catch (org.springframework.web.server.ResponseStatusException ex) { assertEquals(409,ex.getStatusCode().value()); return false; }
                    finally { SecurityContextHolder.clearContext(); } }));
            }
            start.countDown(); int succeeded=0;
            for(var future:futures) if(future.get(20,TimeUnit.SECONDS)) succeeded++;
            assertEquals(1,succeeded); assertEquals(20,music.snapshot().tracks().size()); assertEquals(20,files());
            UUID id=music.snapshot().tracks().getFirst().id();
            CountDownLatch mutate = new CountDownLatch(1);
            Future<?> select=pool.submit(() -> { as("activity-one"); try { mutate.await(); music.select(id); }
                catch(org.springframework.web.server.ResponseStatusException ex) { assertEquals(404,ex.getStatusCode().value()); }
                catch(InterruptedException ex) { throw new RuntimeException(ex); } finally { SecurityContextHolder.clearContext(); } });
            Future<?> delete=pool.submit(() -> { as("activity-two"); try { mutate.await(); music.delete(id); }
                catch(InterruptedException ex) { throw new RuntimeException(ex); } finally { SecurityContextHolder.clearContext(); } });
            mutate.countDown(); select.get(20,TimeUnit.SECONDS); delete.get(20,TimeUnit.SECONDS);
            var snapshot=music.snapshot(); assertNull(snapshot.selectedTrackId()); assertEquals(19,snapshot.tracks().size());
        } finally { pool.shutdownNow(); }
    }
    @Test void quotaChecksTotalBytesAndCollectorKeepsReferencesAndUnrelatedMedia() throws Exception {
        UUID id=upload("已引用");
        String key=db.queryForObject("SELECT storage_key FROM music_tracks WHERE id=?",String.class,id);
        Path keep=storage.directory().resolve(key), orphan=storage.directory().resolve(UUID.randomUUID()+".audio");
        Path unrelated=storage.directory().resolve("preserve-photo.jpg"), fresh=storage.directory().resolve(UUID.randomUUID()+".part");
        Files.write(orphan,new byte[]{1}); Files.write(unrelated,new byte[]{1}); Files.write(fresh,new byte[]{1});
        for(Path path:List.of(keep,orphan,unrelated)) Files.setLastModifiedTime(path,FileTime.from(Instant.now().minusSeconds(7200)));
        music.collectOrphans(); assertTrue(Files.exists(keep)); assertFalse(Files.exists(orphan)); assertTrue(Files.exists(unrelated)); assertTrue(Files.exists(fresh));
        // Populate realistic quota metadata without allocating 200 MiB in test fixtures.
        db.update("UPDATE music_tracks SET byte_size=20971520 WHERE id=?",id);
        for(int i=0;i<9;i++) db.update("INSERT INTO music_tracks(id,title,storage_key,content_type,byte_size,uploaded_by) VALUES (?,?,?,'audio/wav',20971520,1)",UUID.randomUUID(),"容量",UUID.randomUUID()+".audio");
        assertEquals(409,assertThrows(org.springframework.web.server.ResponseStatusException.class,()->upload("溢出")).getStatusCode().value());
        assertEquals(10,music.snapshot().tracks().size()); assertEquals(1,events());
    }
    @Test void authenticatedContentRangesAndMemberWritesWorkThroughRealServices() throws Exception {
        SecurityContextHolder.clearContext();
        mvc.perform(get("/api/v1/music")).andExpect(status().isUnauthorized());
        var result=mvc.perform(multipart("/api/v1/music/tracks").file(wav("接口音乐")).with(user("activity-two").roles("MEMBER")).with(csrf()))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.selectedTrackId").isEmpty()).andReturn();
        var tree=new com.fasterxml.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        String id=tree.path("tracks").get(0).path("id").asText(); String url="/api/v1/music/tracks/"+id+"/content";
        mvc.perform(get(url).header("Range","bytes=0-9")).andExpect(status().isUnauthorized());
        mvc.perform(get(url).with(user("activity-one")).header("Range","bytes=0-9")).andExpect(status().isPartialContent()).andExpect(content().bytes(Arrays.copyOf(MusicFixtures.wav(),10)));
        mvc.perform(get(url).with(user("activity-one")).header("Range","bytes=99999-")).andExpect(status().isRequestedRangeNotSatisfiable()).andExpect(jsonPath("$.code").value("RANGE_NOT_SATISFIABLE"));
        mvc.perform(put("/api/v1/music/selection").with(user("activity-one")).with(csrf()).contentType("application/json").content("{\"trackId\":\""+id+"\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.selectedTrackId").value(id));
        mvc.perform(delete("/api/v1/music/tracks/"+id).with(user("activity-two")).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.tracks").isEmpty());
        mvc.perform(get(url).with(user("activity-one"))).andExpect(status().isNotFound());
    }
}
