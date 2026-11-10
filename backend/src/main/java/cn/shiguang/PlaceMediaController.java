package cn.shiguang;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
class PlaceMediaController {
    private final PlaceService places;
    private final PrivacyService privacy;
    PlaceMediaController(PlaceService places, PrivacyService privacy) { this.places = places; this.privacy = privacy; }

    @GetMapping({"/media/places/{id}", "/public/media/places/{id}"})
    void image(@PathVariable UUID id, @RequestParam(defaultValue = "1920") int w,
                                 @RequestParam UUID v, HttpServletRequest request,
                                 jakarta.servlet.http.HttpServletResponse response) throws java.io.IOException {
        boolean publicly = request.getRequestURI().startsWith("/api/v1/public/");
        // Permission and existence/version checks precede all conditional requests, including wildcard ETags.
        if (publicly) privacy.requirePublic("places");
        if (!PlaceImageProcessor.WIDTHS.contains(w))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "图片宽度仅支持 960、1920、3200 档位");
        var meta = places.metadata(id, v);
        var existing = places.variant(meta, w);
        var rendition = existing.orElseGet(() -> places.derive(id, v, w));
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.CACHE_CONTROL, publicly ? "private, no-cache" : "private, no-store");
        headers.setContentType(MediaType.IMAGE_JPEG);
        headers.setContentDisposition(ContentDisposition.inline().filename("place-" + id + ".jpg").build());
        headers.set("X-Content-Type-Options", "nosniff");
        if (publicly && existing.isPresent() && matches(request.getHeader(HttpHeaders.IF_NONE_MATCH), rendition.etag())) {
            headers.setETag(rendition.etag());
            writeHeaders(response, headers);
            response.setStatus(HttpStatus.NOT_MODIFIED.value());
            return;
        }
        // A matching public conditional request never selects bytea or the historical original.
        byte[] bytes = places.content(rendition);
        if (publicly) headers.setETag(rendition.etag());
        headers.setContentLength(bytes.length);
        // Direct response avoids Spring ResponseEntity's automatic conditional handling after derivation.
        // Headers are applied only after content lookup succeeds, so failures keep the no-store baseline.
        writeHeaders(response, headers);
        response.setStatus(HttpStatus.OK.value());
        response.getOutputStream().write(bytes);
    }
    private static void writeHeaders(jakarta.servlet.http.HttpServletResponse response, HttpHeaders headers) {
        headers.forEach((name, values) -> response.setHeader(name, String.join(", ", values)));
    }
    @ExceptionHandler({org.springframework.web.bind.MissingServletRequestParameterException.class,
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class})
    ResponseEntity<java.util.Map<String, String>> invalidQuery(Exception ignored) {
        return ResponseEntity.badRequest().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(java.util.Map.of("code", "VALIDATION_ERROR", "message", "请提供有效的图片版本与尺寸参数"));
    }
    private static boolean matches(String requested, String actual) {
        if (requested == null) return false;
        for (String candidate : requested.split(",")) {
            String value = candidate.trim();
            if ("*".equals(value) || actual.equals(value.startsWith("W/") ? value.substring(2) : value)) return true;
        }
        return false;
    }
}
