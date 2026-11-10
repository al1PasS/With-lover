package cn.shiguang;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/music")
class MusicController {
    private final MusicService music;
    MusicController(MusicService music) { this.music = music; }

    @GetMapping MusicService.Snapshot snapshot() { return music.snapshot(); }
    @PostMapping(value = "/tracks", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    MusicService.Snapshot upload(@RequestPart("file") MultipartFile file, @RequestParam(required = false) String title) {
        return music.upload(file, title);
    }
    @PutMapping("/selection")
    MusicService.Snapshot select(@RequestBody JsonNode body) {
        if (!body.isObject() || !body.has("trackId") || (!body.get("trackId").isNull() && !body.get("trackId").isTextual()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请提供 trackId（歌曲 ID 或 null）");
        return music.select(body.get("trackId").isNull() ? null : id(body.get("trackId").textValue()));
    }
    @DeleteMapping("/tracks/{trackId}")
    MusicService.Snapshot delete(@PathVariable String trackId) { return music.delete(id(trackId)); }

    @RequestMapping(value = "/tracks/{trackId}/content", method = {RequestMethod.GET, RequestMethod.HEAD})
    ResponseEntity<Resource> content(@PathVariable String trackId, @RequestHeader(value = "Range", required = false) String range) {
        MusicService.Content content = music.content(id(trackId));
        if (range != null) {
            try {
                // A single byte range covers browser audio seeking; reject multipart amplification explicitly.
                if (range.length() > 200) throw new IllegalArgumentException();
                var ranges = HttpRange.parseRanges(range);
                if (ranges.size() != 1) throw new IllegalArgumentException();
                long start = ranges.getFirst().getRangeStart(content.byteSize());
                long end = ranges.getFirst().getRangeEnd(content.byteSize());
                if (start < 0 || start >= content.byteSize() || end < start) throw new IllegalArgumentException();
            } catch (IllegalArgumentException ex) { throw new ApiErrors.MusicRangeException(content.byteSize()); }
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(content.contentType()))
                .contentLength(content.byteSize())
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"music." + (content.contentType().equals("audio/mpeg") ? "mp3" : "wav") + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .body(content.resource());
    }
    private static UUID id(String value) {
        if (value == null || !value.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "音乐 ID 无效");
        return UUID.fromString(value);
    }
}
