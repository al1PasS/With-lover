package cn.shiguang;

import net.coobird.thumbnailator.Thumbnails;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;

@Component
class PlaceImageProcessor {
    static final int MAX_DATA_LENGTH = 8_000_000;
    static final int MAX_BYTES = 6_000_000;
    static final int MAX_DIMENSION = 24_000;
    static final long MAX_PIXELS = 32_000_000;
    static final List<Integer> WIDTHS = List.of(960, 1920, 3200);
    record Variant(int width, int height, String etag, byte[] bytes) {}
    record Prepared(int width, int height, List<Variant> variants) {}
    // Bounds both new uploads and historical lazy derivation; no native codecs or disk ImageIO cache.
    private final Semaphore processing = new Semaphore(2);

    Prepared prepare(Supplier<String> original, boolean newUpload) {
        if (!processing.tryAcquire()) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "图片正在处理中，请稍后重试");
        try { return decode(original.get(), newUpload); }
        finally { processing.release(); }
    }
    Prepared prepare(String original, boolean newUpload) { return prepare(() -> original, newUpload); }

    private Prepared decode(String original, boolean newUpload) {
        if (original == null || original.length() > MAX_DATA_LENGTH) throw invalid();
        int comma = original.indexOf(',');
        if (comma < 0) throw invalid();
        String expected = switch (original.substring(0, comma)) {
            case "data:image/jpeg;base64" -> "jpeg";
            case "data:image/png;base64" -> "png";
            case "data:image/webp;base64" -> "webp";
            default -> throw invalid();
        };
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(original.substring(comma + 1)); }
        catch (IllegalArgumentException ex) { throw invalid(); }
        if (bytes.length == 0 || bytes.length > MAX_BYTES) throw invalid();
        try (var stream = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw invalid();
            ImageReader reader = readers.next();
            BufferedImage source = null;
            try {
                if (!expected.equals(reader.getFormatName().toLowerCase(Locale.ROOT))) throw invalid();
                reader.setInput(stream, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                // These checks happen before allocation/decoding, including for historical originals.
                if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION
                        || (long) width * height > MAX_PIXELS) throw invalid();
                if (newUpload && ((double) width / height < 6 || (double) width / height > 8))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "新长卷图片宽高比须在 6:1 至 8:1 之间");
                source = reader.read(0);
                if (source == null) throw invalid();
                var variants = new ArrayList<Variant>();
                for (int target : WIDTHS) {
                    int actualWidth = Math.min(width, target);
                    if (variants.stream().anyMatch(v -> v.width() == actualWidth)) continue;
                    int actualHeight = Math.max(1, (int) Math.round((double) height * actualWidth / width));
                    BufferedImage scaled = Thumbnails.of(source).forceSize(actualWidth, actualHeight).asBufferedImage();
                    BufferedImage rgb = new BufferedImage(actualWidth, actualHeight, BufferedImage.TYPE_INT_RGB);
                    Graphics2D graphics = rgb.createGraphics();
                    try {
                        graphics.setColor(Color.WHITE);
                        graphics.fillRect(0, 0, actualWidth, actualHeight);
                        graphics.drawImage(scaled, 0, 0, null);
                    } finally { graphics.dispose(); }
                    try (var output = new ByteArrayOutputStream()) {
                        Thumbnails.of(rgb).scale(1).outputFormat("jpg").outputQuality(0.85).toOutputStream(output);
                        byte[] content = output.toByteArray();
                        variants.add(new Variant(actualWidth, actualHeight, digest(content), content));
                    } finally {
                        if (scaled != source) scaled.flush();
                        rgb.flush();
                    }
                }
                return new Prepared(width, height, List.copyOf(variants));
            } finally {
                reader.dispose();
                if (source != null) source.flush();
            }
        } catch (IOException | IllegalArgumentException ex) { throw invalid(); }
    }
    private static String digest(byte[] bytes) {
        try { return "\"" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)) + "\""; }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "图片须为有效的 JPEG、PNG 或 WebP，且不超过安全尺寸与大小限制");
    }
}
