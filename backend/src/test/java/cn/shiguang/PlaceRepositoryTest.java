package cn.shiguang;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PlaceRepositoryTest {
    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test void routineMetadataOperationsUseExplicitColumnsAndNeverSelectPayloads() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        PlaceRepository repo = new PlaceRepository(db);
        UUID id = UUID.randomUUID(), revision = UUID.randomUUID();
        repo.list();
        repo.find(id);
        repo.lock(id);
        repo.variants();
        repo.variants(id, revision);
        var sql = ArgumentCaptor.forClass(String.class);
        verify(db, times(2)).query(sql.capture(), any(RowMapper.class));
        verify(db, times(1)).query(sql.capture(), any(RowMapper.class), eq(id), eq(revision));
        verify(db, times(2)).query(sql.capture(), any(RowMapper.class), eq(id));
        for (String statement : sql.getAllValues()) {
            assertTrue(statement.startsWith("SELECT "));
            assertFalse(statement.contains("SELECT *"), statement);
            assertFalse(statement.contains("panorama_image"), statement);
            assertFalse(statement.contains("reference_image"), statement);
            assertFalse(statement.contains("v.content "), statement);
            assertFalse(statement.contains("generation_prompt"), statement);
        }
        repo.updateText(id, new PlaceController.Input("城市", null, null, "说明"));
        repo.reorder(id, 1);
        repo.delete(id);
        verify(db).update(eq("UPDATE places SET city=?,name=?,visit_date=?,description=? WHERE id=?"), eq("城市"), eq("城市"), isNull(), eq("说明"), eq(id));
        verify(db).update(eq("UPDATE places SET sort_order=? WHERE id=?"), eq(1), eq(id));
        verify(db).update(eq("DELETE FROM places WHERE id=?"), eq(id));
    }
    @Test void legacyOriginalFetchIsBoundedAtDatabaseBoundary() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        UUID id = UUID.randomUUID(), revision = UUID.randomUUID();
        new PlaceRepository(db).original(id, revision);
        verify(db).queryForObject(eq("SELECT CASE WHEN panorama_image='' THEN CASE WHEN octet_length(reference_image)<=? THEN reference_image END "
                        + "WHEN octet_length(panorama_image)<=? THEN panorama_image END FROM places WHERE id=? AND image_revision=?"),
                eq(String.class), eq(PlaceImageProcessor.MAX_DATA_LENGTH), eq(PlaceImageProcessor.MAX_DATA_LENGTH), eq(id), eq(revision));
    }
}
