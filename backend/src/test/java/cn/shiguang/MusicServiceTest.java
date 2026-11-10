package cn.shiguang;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MusicServiceTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final MusicStorage storage = mock(MusicStorage.class);
    private final UUID id = UUID.randomUUID();
    private MusicService music;

    @BeforeEach void setup() {
        music = new MusicService(db, mock(ActivityService.class), storage, mock(MusicValidator.class),
                mock(PlatformTransactionManager.class), 20971520, 20, 209715200, 2, Duration.ofHours(1));
    }
    @Test void publicSnapshotQueriesOnlySelectionAndRevisionNotLibraryMetadata() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject(1, UUID.class)).thenReturn(id);
        when(rs.getLong(2)).thenReturn(7L);
        when(db.queryForObject(anyString(), org.mockito.ArgumentMatchers.<RowMapper<Object>>any())).thenAnswer(invocation -> {
            assertEquals("SELECT selected_track_id,revision FROM music_state WHERE id=1", invocation.getArgument(0));
            return invocation.<RowMapper<?>>getArgument(1).mapRow(rs, 0);
        });
        assertEquals(new MusicService.PublicMusicSnapshot(id, 7), music.publicSnapshot());
        when(rs.getObject(1, UUID.class)).thenReturn(null);
        assertEquals(new MusicService.PublicMusicSnapshot(null, 7), music.publicSnapshot());
        verify(db, times(2)).queryForObject(anyString(), org.mockito.ArgumentMatchers.<RowMapper<Object>>any());
        verifyNoMoreInteractions(db);
        verifyNoInteractions(storage);
    }
    @Test void nonCurrentAndMissingTracksNeverResolveStorage() {
        when(db.query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<Object>>any(), eq(id))).thenAnswer(invocation -> {
            assertSelectionJoin(invocation.getArgument(0));
            return List.of();
        });
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> music.publicContent(id)).getStatusCode().value());
        verifyNoInteractions(storage);
    }
    @Test void eachContentRequestRejoinsSelectionBeforeAccessingResource() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("id", UUID.class)).thenReturn(id);
        when(rs.getString("title")).thenReturn("private metadata");
        when(rs.getString("content_type")).thenReturn("audio/wav");
        when(rs.getLong("byte_size")).thenReturn(3L);
        when(rs.getTimestamp("created_at")).thenReturn(Timestamp.from(Instant.EPOCH));
        when(rs.getString("storage_key")).thenReturn("selected.audio");
        var resource = new ByteArrayResource(new byte[]{1, 2, 3});
        when(storage.resource("selected.audio", 3)).thenReturn(resource);
        when(db.query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<Object>>any(), eq(id)))
                .thenAnswer(invocation -> {
                    assertSelectionJoin(invocation.getArgument(0));
                    return List.of(invocation.<RowMapper<?>>getArgument(1).mapRow(rs, 0));
                }).thenReturn(List.of()); // A later request after changing/clearing/deleting the selection.
        assertEquals(new MusicService.Content(resource, "audio/wav", 3), music.publicContent(id));
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> music.publicContent(id)).getStatusCode().value());
        var order = inOrder(db, storage);
        order.verify(db).query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<Object>>any(), eq(id));
        order.verify(storage).resource("selected.audio", 3);
        order.verify(db).query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<Object>>any(), eq(id));
        verifyNoMoreInteractions(storage);
    }
    private static void assertSelectionJoin(String sql) {
        assertEquals("SELECT track.* FROM music_tracks track JOIN music_state state ON state.selected_track_id=track.id WHERE state.id=1 AND track.id=?",
                sql.trim().replaceAll("\\s+", " "));
    }
}
