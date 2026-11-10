package cn.shiguang;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PlaceImageProcessorTest {
    final PlaceImageProcessor processor = new PlaceImageProcessor();
    static String image(int width, int height, String format) throws Exception {
        BufferedImage image = new BufferedImage(width, height, format.equals("png") ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        var graphics = image.createGraphics();
        graphics.setColor(Color.ORANGE);
        graphics.fillRect(0, 0, width / 2, height);
        graphics.dispose();
        try (var out = new ByteArrayOutputStream()) {
            assertTrue(ImageIO.write(image, format, out));
            return "data:image/" + (format.equals("jpg") ? "jpeg" : format) + ";base64," + Base64.getEncoder().encodeToString(out.toByteArray());
        }
    }
    @Test void generatesOnlyFixedBucketsAtActualSizeAndStripsMetadata() throws Exception {
        var prepared = processor.prepare(image(3500, 500, "jpg"), true);
        assertEquals(3500, prepared.width());
        assertEquals(500, prepared.height());
        assertEquals(List.of(960, 1920, 3200), prepared.variants().stream().map(PlaceImageProcessor.Variant::width).toList());
        for (var variant : prepared.variants()) {
            var decoded = ImageIO.read(new ByteArrayInputStream(variant.bytes()));
            assertEquals(variant.width(), decoded.getWidth());
            assertEquals(variant.height(), decoded.getHeight());
            assertEquals(66, variant.etag().length());
            assertEquals(0xff, variant.bytes()[0] & 255);
            assertEquals(0xd8, variant.bytes()[1] & 255);
        }
    }
    @Test void smallImagesAreNotUpscaledAndTransparentPngIsFlattenedWhite() throws Exception {
        var prepared = processor.prepare(image(700, 100, "png"), true);
        assertEquals(1, prepared.variants().size());
        var decoded = ImageIO.read(new ByteArrayInputStream(prepared.variants().getFirst().bytes()));
        assertEquals(700, decoded.getWidth());
        assertTrue(new Color(decoded.getRGB(600, 50)).getRed() > 245);
        assertTrue(new Color(decoded.getRGB(600, 50)).getBlue() > 245);
        assertFalse(decoded.getColorModel().hasAlpha());
    }
    @Test void abnormalLegacyAspectRatioIsPreservedButNewUploadsAreRejected() throws Exception {
        String square = image(200, 200, "png");
        assertEquals(200, processor.prepare(square, false).height());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class, () -> processor.prepare(square, true)).getStatusCode());
        processor.prepare(image(600, 100, "jpg"), true);
        processor.prepare(image(800, 100, "jpg"), true);
    }
    @Test void rejectsLinksEmptyMalformedSvgSpoofedAndOversizeImages() throws Exception {
        for (String invalid : List.of("", "https://example.com/a.jpg", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/jpeg;base64,???"))
            assertThrows(ResponseStatusException.class, () -> processor.prepare(invalid, true));
        assertThrows(ResponseStatusException.class, () -> processor.prepare((String) null, true));
        String png = image(700, 100, "png");
        assertThrows(ResponseStatusException.class, () -> processor.prepare(png.replace("image/png", "image/jpeg"), true));
        assertThrows(ResponseStatusException.class, () -> processor.prepare("x".repeat(PlaceImageProcessor.MAX_DATA_LENGTH + 1), false));
        // Very wide but tiny compressed input: pre-decode dimension guard applies to legacy as well.
        String wide = image(24_001, 1, "png");
        assertThrows(ResponseStatusException.class, () -> processor.prepare(wide, false));
        assertThrows(ResponseStatusException.class, () -> processor.prepare(image(8000, 4100, "png"), false));
    }
    @Test void decodeConcurrencyIsBoundedAndSlotsAreReleased() throws Exception {
        var entered = new java.util.concurrent.CountDownLatch(2);
        var release = new java.util.concurrent.CountDownLatch(1);
        var executor = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            java.util.concurrent.Callable<Void> work = () -> {
                assertThrows(ResponseStatusException.class, () -> processor.prepare(() -> {
                    entered.countDown();
                    try { assertTrue(release.await(5, java.util.concurrent.TimeUnit.SECONDS)); }
                    catch (InterruptedException ex) { throw new AssertionError(ex); }
                    return "invalid";
                }, false));
                return null;
            };
            var one = executor.submit(work);
            var two = executor.submit(work);
            assertTrue(entered.await(5, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(HttpStatus.TOO_MANY_REQUESTS, assertThrows(ResponseStatusException.class,
                    () -> processor.prepare(() -> { fail("must not fetch an original without a decoder slot"); return ""; }, false)).getStatusCode());
            release.countDown();
            one.get(5, java.util.concurrent.TimeUnit.SECONDS);
            two.get(5, java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(700, processor.prepare(image(700, 100, "jpg"), true).width());
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }
    @Test void readsLegacyWebpWithTwelveMonkeys() {
        String webp = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
        var decoded = processor.prepare(webp, false);
        assertEquals(1, decoded.width());
        assertEquals(1, decoded.height());
        assertEquals(1, decoded.variants().size());
    }
}
