package cn.shiguang;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MusicStorageTest {
    @TempDir Path temp;
    @Test void copiesBoundedStreamAndPublishesRandomFilename() throws Exception {
        MusicStorage storage = new MusicStorage(temp.toString());
        byte[] data = MusicFixtures.wav();
        Path stage = storage.stage(new MockMultipartFile("file", "original.wav", "audio/wav", data), 20971520);
        assertTrue(stage.getFileName().toString().endsWith(".part"));
        String key = storage.publish(stage);
        assertTrue(key.matches("[0-9a-f-]{36}\\.audio"));
        assertArrayEquals(data, storage.resource(key, data.length).getContentAsByteArray());
        assertFalse(Files.exists(stage));
        assertThrows(IllegalArgumentException.class, () -> storage.resource("../private", data.length));
        storage.delete(key);
        assertThrows(ResponseStatusException.class, () -> storage.resource(key, data.length));
    }
    @Test void refusesOversizeDeclaredFilesAndLeavesExistingFilesAlone() throws Exception {
        MusicStorage storage = new MusicStorage(temp.toString());
        Files.createDirectories(storage.directory());
        Path existing = storage.directory().resolve("existing-photo.jpg"); Files.write(existing,new byte[]{1});
        MultipartFile file = mock(MultipartFile.class); when(file.getSize()).thenReturn(21L * 1024 * 1024);
        assertEquals(413,assertThrows(ResponseStatusException.class,()->storage.stage(file,20971520)).getStatusCode().value());
        verify(file,never()).getInputStream(); assertTrue(Files.exists(existing));
    }
    @Test void enforcesActualStreamSizeEvenIfMultipartSizeLiesAndRemovesPartialFile() throws Exception {
        MusicStorage storage = new MusicStorage(temp.toString());
        MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(1L); when(file.getInputStream()).thenReturn(new ByteArrayInputStream(new byte[100]));
        assertEquals(413, assertThrows(ResponseStatusException.class, () -> storage.stage(file, 50)).getStatusCode().value());
        try (var files = Files.list(storage.directory())) { assertEquals(0, files.count()); }
    }
    @Test void collectorOnlyRemovesOldUnreferencedOwnedRegularFilesWithoutRecursing() throws Exception {
        MusicStorage storage = new MusicStorage(temp.toString());
        Files.createDirectories(storage.directory());
        Path orphan = storage.directory().resolve(UUID.randomUUID()+".audio");
        Path part = storage.directory().resolve(UUID.randomUUID()+".part");
        Path referenced = storage.directory().resolve(UUID.randomUUID()+".audio");
        Path fresh = storage.directory().resolve(UUID.randomUUID()+".audio");
        Path unknown = storage.directory().resolve("photo.jpg");
        Path outside = temp.resolve("outside.audio");
        Path nested = storage.directory().resolve(UUID.randomUUID()+".audio");
        for (Path path : new Path[]{orphan, part, referenced, fresh, unknown, outside}) Files.write(path, new byte[]{1});
        Files.createDirectory(nested); Files.write(nested.resolve("keep"), new byte[]{1});
        Path symlink = storage.directory().resolve(UUID.randomUUID()+".audio");
        Files.createSymbolicLink(symlink, outside);
        for (Path path : new Path[]{orphan, part, referenced, unknown, outside, nested})
            Files.setLastModifiedTime(path, FileTime.from(Instant.now().minusSeconds(7200)));
        storage.collect(Set.of(referenced.getFileName().toString()), Instant.now().minusSeconds(3600));
        assertFalse(Files.exists(orphan)); assertFalse(Files.exists(part));
        for (Path path : new Path[]{referenced, fresh, unknown, outside, nested, symlink}) assertTrue(Files.exists(path));
    }
    @Test void refusesSymbolicStorageDirectory() throws Exception {
        Path outside = Files.createDirectory(temp.resolve("outside"));
        Files.createSymbolicLink(temp.resolve("music"), outside);
        MusicStorage storage = new MusicStorage(temp.toString());
        assertThrows(java.io.IOException.class, () -> storage.stage(new MockMultipartFile("file", new byte[]{1}), 20));
    }
}
