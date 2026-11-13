package cn.shiguang;

import net.coobird.thumbnailator.Thumbnails;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.Semaphore;

@Component
class AlbumImages {
    private final Semaphore slots = new Semaphore(2);
    record Image(byte[] content, byte[] thumbnail) {}

    Image prepare(MultipartFile file) {
        if (file.isEmpty() || file.getSize() > 20 * 1024 * 1024) throw invalid();
        if (!slots.tryAcquire()) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "照片正在处理中，请稍后重试");
        try (var raw = file.getInputStream(); var stream = new MemoryCacheImageInputStream(raw)) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw invalid();
            var reader = readers.next();
            try {
                if (!Set.of("JPEG", "png", "PNG", "WebP", "webp", "GIF", "gif").contains(reader.getFormatName())) throw invalid();
                reader.setInput(stream, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 16000 || height > 16000 || (long) width * height > 48_000_000L)
                    throw invalid();
                int sampling = Math.max(1, Math.max(width, height) / 1800);
                var params = reader.getDefaultReadParam();
                params.setSourceSubsampling(sampling, sampling, 0, 0);
                BufferedImage source = reader.read(0, params);
                if (source == null) throw invalid();
                try {
                    var content = jpeg(source, 1800, 0.88);
                    return new Image(content, jpeg(source, 640, 0.83));
                } finally { source.flush(); }
            } finally { reader.dispose(); }
        } catch (IOException | IllegalArgumentException e) { throw invalid(); }
        finally { slots.release(); }
    }

    private byte[] jpeg(BufferedImage source, int max, double quality) throws IOException {
        double scale = Math.min(1, (double) max / Math.max(source.getWidth(), source.getHeight()));
        int width = Math.max(1, (int) Math.round(source.getWidth() * scale));
        int height = Math.max(1, (int) Math.round(source.getHeight() * scale));
        var resized = Thumbnails.of(source).forceSize(width,height).asBufferedImage();
        var rgb = new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB);
        var graphics = rgb.createGraphics();
        try {
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0,0,width,height);
            graphics.drawImage(resized,0,0,null);
        } finally { graphics.dispose(); }
        try (var out = new ByteArrayOutputStream()) {
            Thumbnails.of(rgb).scale(1).outputFormat("jpg").outputQuality(quality).toOutputStream(out);
            return out.toByteArray();
        } finally {
            if (resized != source) resized.flush();
            rgb.flush();
        }
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "无法读取这张图片，请选择 20 MB 以内的 JPEG、PNG、WebP 或 GIF");
    }
}
