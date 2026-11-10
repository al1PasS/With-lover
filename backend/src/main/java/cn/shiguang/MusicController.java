package cn.shiguang;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
class MusicController {
    private final MusicService music;
    private final PrivacyService privacy;
    MusicController(MusicService music, PrivacyService privacy) { this.music = music; this.privacy = privacy; }

    @GetMapping("/music") MusicService.Snapshot snapshot() { return music.snapshot(); }
    @GetMapping("/public/music")
    MusicService.PublicMusicSnapshot publicSnapshot(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
        privacy.requirePublicMusic();
        return music.publicSnapshot();
    }
    @RequestMapping(value = "/public/music/tracks/{trackId}/content", method = {RequestMethod.GET, RequestMethod.HEAD})
    ResponseEntity<Resource> publicContent(@PathVariable String trackId, @RequestHeader(value = "Range", required = false) String range,
                                           HttpServletRequest request, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
        privacy.requirePublicMusic();
        return contentResponse(music.publicContent(id(trackId)), range, "HEAD".equals(request.getMethod()));
    }
    @PostMapping(value = "/music/tracks", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    MusicService.Snapshot upload(@RequestPart("file") MultipartFile file, @RequestParam(required = false) String title) {
        return music.upload(file, title);
    }
    @PutMapping("/music/selection")
    MusicService.Snapshot select(@RequestBody JsonNode body) {
        if (!body.isObject() || !body.has("trackId") || (!body.get("trackId").isNull() && !body.get("trackId").isTextual()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请提供 trackId（歌曲 ID 或 null）");
        return music.select(body.get("trackId").isNull() ? null : id(body.get("trackId").textValue()));
    }
    @DeleteMapping("/music/tracks/{trackId}")
    MusicService.Snapshot delete(@PathVariable String trackId) { return music.delete(id(trackId)); }

    @RequestMapping(value = "/music/tracks/{trackId}/content", method = {RequestMethod.GET, RequestMethod.HEAD})
    ResponseEntity<Resource> content(@PathVariable String trackId, @RequestHeader(value = "Range", required = false) String range,
                                     HttpServletRequest request) {
        return contentResponse(music.content(id(trackId)), range, "HEAD".equals(request.getMethod()));
    }
    static ResponseEntity<Resource> contentResponse(MusicService.Content content, String range, boolean head) {
        long start = 0, end = content.byteSize() - 1;
        if (range != null) {
            try {
                // A single byte range covers browser audio seeking; reject multipart amplification explicitly.
                if (range.length() > 200) throw new IllegalArgumentException();
                var ranges = HttpRange.parseRanges(range);
                if (ranges.size() != 1) throw new IllegalArgumentException();
                start = ranges.getFirst().getRangeStart(content.byteSize());
                end = ranges.getFirst().getRangeEnd(content.byteSize());
                if (start < 0 || start >= content.byteSize() || end < start) throw new IllegalArgumentException();
            } catch (IllegalArgumentException ex) { throw new ApiErrors.MusicRangeException(content.byteSize()); }
        }
        var response = ResponseEntity.status(head && range != null ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK)
                .contentType(MediaType.parseMediaType(content.contentType()))
                .contentLength(head ? end - start + 1 : content.byteSize())
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"music." + (content.contentType().equals("audio/mpeg") ? "mp3" : "wav") + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.ACCEPT_RANGES, "bytes");
        if (head) {
            if (range != null) response.header(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + content.byteSize());
            return response.build();
        }
        // Spring MVC writes the Resource (or its single ResourceRegion for GET Range requests).
        return response.body(content.resource());
    }
    private static UUID id(String value) {
        if (value == null || !value.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "音乐 ID 无效");
        return UUID.fromString(value);
    }
}
