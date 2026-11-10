package cn.shiguang;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@Component
class MusicStorage {
    private static final Logger log = LoggerFactory.getLogger(MusicStorage.class);
    private static final Pattern OWNED = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(audio|part)");
    private final Path directory;

    MusicStorage(@Value("${shiguang.media-root:./media}") String root) {
        directory = Path.of(root).toAbsolutePath().normalize().resolve("music");
    }
    Path directory() { return directory; }
    private void initialize() throws IOException {
        Files.createDirectories(directory);
        if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))
            throw new IOException("Music storage must be a private directory");
        if (Files.getFileStore(directory).supportsFileAttributeView("posix"))
            Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
    }
    Path stage(MultipartFile file, long maxBytes) throws IOException {
        if (file.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择非空的音乐文件");
        if (file.getSize() > maxBytes) throw tooLarge();
        initialize();
        Path path = directory.resolve(UUID.randomUUID() + ".part");
        try (InputStream input = file.getInputStream();
             OutputStream output = Files.newOutputStream(path, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            for (int n; (n = input.read(buffer)) != -1;) {
                if (n == 0) continue;
                total += n;
                if (total > maxBytes) throw tooLarge();
                output.write(buffer, 0, n);
            }
            if (total == 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择非空的音乐文件");
            return path;
        } catch (IOException | RuntimeException ex) {
            removeQuietly(path);
            throw ex;
        }
    }
    String publish(Path staged) throws IOException {
        String key = UUID.randomUUID() + ".audio";
        Files.move(staged, resolve(key), StandardCopyOption.ATOMIC_MOVE);
        return key;
    }
    private Path resolve(String key) {
        if (key == null || !OWNED.matcher(key).matches() || !key.endsWith(".audio"))
            throw new IllegalArgumentException("Invalid music storage key");
        return directory.resolve(key);
    }
    Resource resource(String key, long size) throws IOException {
        Path path = resolve(key);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) != size)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "音乐文件不存在或不可读取");
        return new FileSystemResource(path);
    }
    void delete(String key) { removeQuietly(resolve(key)); }
    void removeQuietly(Path path) {
        try { Files.deleteIfExists(path); }
        catch (IOException | SecurityException ex) { log.warn("Music file cleanup deferred; the orphan collector will retry"); }
    }
    /** Called only while holding music_state FOR UPDATE. Never recurse, follow links or touch unknown names. */
    void collect(Set<String> referenced, Instant olderThan) throws IOException {
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return;
        initialize();
        try (DirectoryStream<Path> entries = Files.newDirectoryStream(directory)) {
            for (Path path : entries) {
                String key = path.getFileName().toString();
                if (!OWNED.matcher(key).matches() || referenced.contains(key)) continue;
                BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                if (attrs.isRegularFile() && attrs.lastModifiedTime().toInstant().isBefore(olderThan)) removeQuietly(path);
            }
        }
    }
    private static ResponseStatusException tooLarge() {
        return new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "音乐文件不能超过单文件容量限制（最多 20 MiB）");
    }
}
