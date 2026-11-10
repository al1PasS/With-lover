package cn.shiguang;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.util.concurrent.*;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Opt-in only: configure an isolated, disposable PostgreSQL database as for ActivityIntegrationTest. */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "ACTIVITY_DB_TEST", matches = "true")
class PlaceIntegrationTest {
    @Autowired JdbcTemplate db;
    @Autowired PlaceService service;
    @Autowired PlaceRepository repo;
    @Autowired MockMvc mvc;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
    @MockitoSpyBean PlaceImageProcessor processor;
    @MockitoSpyBean ActivityService activity;
    @BeforeEach void accounts() {
        db.update("INSERT INTO accounts(id,username,password,nickname,role) VALUES (1,'activity-one','unused','合成一','ADMIN'),(2,'activity-two','unused','合成二','MEMBER') ON CONFLICT DO NOTHING");
    }
    UUID legacy(String original) {
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO places(id,city,name,panorama_image) VALUES (?,'合成城市','合成城市',?)", id, original);
        return id;
    }
    @Test void brokenLegacyOriginalRemainsUntouchedAndCannotBreakTheList() {
        UUID id = legacy("broken-preserved-original");
        try {
            UUID revision = repo.find(id).orElseThrow().revision();
            assertTrue(service.list(false).stream().anyMatch(p -> p.id().equals(id)));
            assertEquals(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,
                    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> service.derive(id, revision, 1920)).getStatusCode());
            assertEquals("broken-preserved-original", repo.original(id, revision));
            assertTrue(repo.variants(id, revision).isEmpty());
        } finally { db.update("DELETE FROM places WHERE id=?", id); }
    }
    @Test @Transactional void metadataDoesNotDecodeBrokenHistoricalImagesAndLazyDerivationIsPersistent() throws Exception {
        UUID id = legacy("");
        db.update("UPDATE places SET reference_image=? WHERE id=?", PlaceImageProcessorTest.image(250, 250, "png"), id);
        var before = repo.find(id).orElseThrow();
        assertNull(before.width());
        assertTrue(service.list(false).stream().anyMatch(p -> p.id().equals(id)));
        var first = service.derive(id, before.revision(), 1920);
        assertEquals(250, first.width());
        assertEquals(first, service.derive(id, before.revision(), 3200));
        assertEquals(1, db.queryForObject("SELECT count(*) FROM place_image_variants WHERE place_id=?", Integer.class, id));
        assertNotNull(repo.find(id).orElseThrow().width());
        verify(processor, times(1)).prepare(anySupplier(), eq(false));
        db.update("DELETE FROM places WHERE id=?", id);
        assertEquals(0, db.queryForObject("SELECT count(*) FROM place_image_variants WHERE place_id=?", Integer.class, id));
    }
    @Test @Transactional void textEditKeepsOriginalAndVersionWhileReplacementChangesVersionAndRollsBackWithActivity() throws Exception {
        UUID id = legacy(PlaceImageProcessorTest.image(700, 100, "png"));
        var before = repo.find(id).orElseThrow();
        var one = user("activity-one").roles("ADMIN");
        mvc.perform(patch("/api/v1/admin/places/" + id).with(one).with(csrf()).contentType("application/json").content("{\"city\":\"新城市\",\"description\":\"说明\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.image.version").value(before.revision().toString()))
                .andExpect(jsonPath("$.panoramaImage").doesNotExist());
        assertEquals(before.revision(), repo.find(id).orElseThrow().revision());
        String original = repo.original(id, before.revision());
        String next = PlaceImageProcessorTest.image(1400, 200, "jpg");
        String json = "{\"city\":\"替换城市\",\"panoramaImage\":\"" + next + "\"}";
        mvc.perform(patch("/api/v1/admin/places/" + id).with(one).with(csrf()).contentType("application/json").content(json)).andExpect(status().isOk());
        var after = repo.find(id).orElseThrow();
        assertNotEquals(before.revision(), after.revision());
        assertEquals(next, repo.original(id, after.revision()));
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> service.metadata(id, before.revision()));
        assertNotEquals(original, next);
        assertFalse(repo.variants(id, after.revision()).isEmpty());
        assertTrue(repo.variants(id, before.revision()).isEmpty());
    }
    @Test void activityFailureRollsBackImageAndTextTogether() throws Exception {
        UUID id = legacy(PlaceImageProcessorTest.image(700, 100, "png"));
        var before = repo.find(id).orElseThrow();
        doThrow(new IllegalStateException("synthetic rollback")).when(activity).record(eq("places"), eq(id.toString()), anyString(), anyString(), anyString(), anyString());
        try {
            String replacement = PlaceImageProcessorTest.image(1400, 200, "png");
            assertThrows(IllegalStateException.class, () -> service.update(id, new PlaceController.Input("回滚城市", replacement, null, "")));
            assertEquals(before, repo.find(id).orElseThrow());
            assertTrue(repo.variants(id, before.revision()).isEmpty());
        } finally {
            reset(activity);
            db.update("DELETE FROM places WHERE id=?", id);
        }
    }
    @Test void concurrentLegacyReadsDecodeOnlyOnceAndReplacementCannotPublishOldBytes() throws Exception {
        UUID id = legacy(PlaceImageProcessorTest.image(700, 100, "png"));
        var before = repo.find(id).orElseThrow();
        CountDownLatch entered = new CountDownLatch(1), proceed = new CountDownLatch(1);
        doAnswer(invocation -> {
            entered.countDown();
            if (!proceed.await(5, TimeUnit.SECONDS)) throw new AssertionError("derivation barrier timed out");
            return invocation.callRealMethod();
        }).when(processor).prepare(anySupplier(), eq(false));
        ExecutorService executor = Executors.newFixedThreadPool(3);
        try {
            Future<?> first = executor.submit(() -> service.derive(id, before.revision(), 960));
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            Future<?> second = executor.submit(() -> service.derive(id, before.revision(), 1920));
            proceed.countDown();
            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);
            verify(processor, times(1)).prepare(anySupplier(), eq(false));
            assertEquals(1, repo.variants(id, before.revision()).size());
            transactions.executeWithoutResult(status -> {
                repo.lock(id);
                repo.replace(id, "replacement-placeholder", UUID.randomUUID());
            });
            assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> service.derive(id, before.revision(), 960));
            assertTrue(repo.content(id, before.revision(), 700).isEmpty());
        } finally {
            proceed.countDown();
            executor.shutdownNow();
            reset(processor);
            db.update("DELETE FROM places WHERE id=?", id);
        }
    }
    @SuppressWarnings("unchecked")
    private static Supplier<String> anySupplier() { return any(Supplier.class); }
}
