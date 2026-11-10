package cn.shiguang;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Locale;
import java.util.Set;

/** Bounded structural validation; neither the browser MIME nor a file extension is trusted. */
@Component
class MusicValidator {
    static final long HARD_MAX_FILE_BYTES = 20L * 1024 * 1024;
    private static final int MAX_ID3_BYTES = 1024 * 1024;
    record Validated(String title, String contentType) {}

    Validated validate(Path path, String filename, String declaredType, String title) throws IOException {
        validateName(filename, 255);
        String lower = filename.toLowerCase(Locale.ROOT);
        boolean mp3 = lower.endsWith(".mp3"), wav = lower.endsWith(".wav");
        if (!mp3 && !wav) throw unsupported();
        String display = title == null || title.isBlank() ? filename.substring(0, filename.length() - 4) : title.strip();
        validateName(display, 120);
        String type = declaredType == null ? "" : declaredType.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
        Set<String> allowed = mp3 ? Set.of("", "application/octet-stream", "audio/mpeg", "audio/mp3")
                : Set.of("", "application/octet-stream", "audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave");
        if (!allowed.contains(type)) throw unsupported();
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long size = channel.size();
            if (size == 0) throw invalid();
            if (size > HARD_MAX_FILE_BYTES) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "音乐文件不能超过 20 MiB");
            if (mp3) validateMp3(channel, size); else validateWav(channel, size);
        }
        return new Validated(display, mp3 ? "audio/mpeg" : "audio/wav");
    }

    private static void validateName(String value, int max) {
        if (value == null || value.isBlank() || value.codePointCount(0, value.length()) > max
                || value.equals(".") || value.equals("..") || value.codePoints().anyMatch(c -> c == '/' || c == '\\'
                || c == ':' || Character.isISOControl(c) || Character.getType(c) == Character.FORMAT
                || Character.getType(c) == Character.SURROGATE)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "音乐名称无效，请使用不含路径或控制字符的简短名称");
        }
    }

    private static ByteBuffer read(FileChannel channel, long offset, int count) throws IOException {
        if (offset < 0 || count < 0 || offset + count > channel.size()) throw invalid();
        ByteBuffer buffer = ByteBuffer.allocate(count).order(ByteOrder.LITTLE_ENDIAN);
        while (buffer.hasRemaining()) {
            int n = channel.read(buffer, offset + buffer.position());
            if (n <= 0) throw invalid();
        }
        return buffer.flip();
    }
    private static boolean magic(ByteBuffer bytes, String value) {
        if (bytes.remaining() < value.length()) return false;
        for (int i = 0; i < value.length(); i++) if (bytes.get(i) != (byte) value.charAt(i)) return false;
        return true;
    }
    private static long u32(ByteBuffer b, int offset) { return Integer.toUnsignedLong(b.getInt(offset)); }
    private static int u16(ByteBuffer b, int offset) { return Short.toUnsignedInt(b.getShort(offset)); }

    private static void validateWav(FileChannel channel, long size) throws IOException {
        ByteBuffer header = read(channel, 0, 12);
        if (!magic(header, "RIFF") || !magic(read(channel, 8, 4), "WAVE")) throw invalid();
        if (u32(header, 4) + 8 != size) throw invalid();
        long offset = 12;
        int chunks = 0, alignment = 0;
        boolean format = false, data = false;
        while (offset < size) {
            if (++chunks > 1024) throw invalid();
            ByteBuffer chunk = read(channel, offset, 8);
            long length = u32(chunk, 4), end = offset + 8 + length;
            if (end > size || end + (length & 1) > size) throw invalid();
            if (magic(chunk, "fmt ")) {
                if (format || data || (length != 16 && length != 18)) throw invalid();
                ByteBuffer fmt = read(channel, offset + 8, (int) length);
                int encoding = u16(fmt, 0), channels = u16(fmt, 2), bits = u16(fmt, 14);
                long rate = u32(fmt, 4), byteRate = u32(fmt, 8);
                alignment = u16(fmt, 12);
                if (encoding != 1 || (channels != 1 && channels != 2) || rate < 8000 || rate > 192000
                        || !Set.of(8, 16, 24, 32).contains(bits) || alignment != channels * bits / 8
                        || byteRate != rate * alignment || (length == 18 && u16(fmt, 16) != 0)) throw invalid();
                format = true;
            } else if (magic(chunk, "data")) {
                if (!format || data || length == 0 || length % alignment != 0) throw invalid();
                data = true;
            }
            offset = end + (length & 1);
        }
        if (!format || !data || offset != size) throw invalid();
    }

    private static int synchsafe(ByteBuffer b, int offset) {
        int size = 0;
        for (int i = 0; i < 4; i++) {
            int value = Byte.toUnsignedInt(b.get(offset + i));
            if ((value & 128) != 0) throw invalid();
            size = (size << 7) | value;
        }
        return size;
    }
    private static void validateMp3(FileChannel channel, long size) throws IOException {
        long offset = 0, end = size;
        if (magic(read(channel, 0, (int) Math.min(size, 10)), "ID3")) {
            ByteBuffer tag = read(channel, 0, 10);
            int version = Byte.toUnsignedInt(tag.get(3)), flags = Byte.toUnsignedInt(tag.get(5));
            int permitted = version == 2 ? 0xc0 : version == 3 ? 0xe0 : version == 4 ? 0xf0 : -1;
            if (permitted == -1 || Byte.toUnsignedInt(tag.get(4)) == 255 || (flags & ~permitted) != 0
                    || (version == 2 && (flags & 0x40) != 0)) throw invalid();
            int length = synchsafe(tag, 6);
            if (length > MAX_ID3_BYTES) throw invalid();
            offset = 10L + length;
            if (offset > size) throw invalid();
            if ((version == 3 || version == 4) && (flags & 0x40) != 0) {
                ByteBuffer extended = read(channel, 10, 4);
                long extendedLength = version == 4 ? synchsafe(extended, 0)
                        : Integer.toUnsignedLong(extended.order(ByteOrder.BIG_ENDIAN).getInt(0)) + 4;
                if (extendedLength < (version == 4 ? 6 : 10) || extendedLength > length) throw invalid();
            }
            if (version == 4 && (flags & 0x10) != 0) {
                ByteBuffer footer = read(channel, offset, 10);
                if (!magic(footer, "3DI")) throw invalid();
                for (int i = 3; i < 10; i++) if (footer.get(i) != tag.get(i)) throw invalid();
                offset += 10;
            }
        }
        if (end - offset >= 128 && magic(read(channel, end - 128, 3), "TAG")) end -= 128;
        int frames = 0, streamVersion = -1, streamRate = -1, precedingMainBytes = 0;
        while (offset < end) {
            if (end - offset < 4) throw invalid();
            int h = read(channel, offset, 4).order(ByteOrder.BIG_ENDIAN).getInt();
            int version = (h >>> 19) & 3, layer = (h >>> 17) & 3;
            int bitrateIndex = (h >>> 12) & 15, rateIndex = (h >>> 10) & 3;
            if ((h & 0xffe00000) != 0xffe00000 || version == 1 || layer != 1
                    || bitrateIndex == 0 || bitrateIndex == 15 || rateIndex == 3 || (h & 3) == 2) throw invalid();
            int[] mpeg1 = {0,32,40,48,56,64,80,96,112,128,160,192,224,256,320};
            int[] mpeg2 = {0,8,16,24,32,40,48,56,64,80,96,112,128,144,160};
            int rate = new int[]{44100,48000,32000}[rateIndex] / (version == 3 ? 1 : version == 2 ? 2 : 4);
            int bitrate = (version == 3 ? mpeg1 : mpeg2)[bitrateIndex] * 1000;
            int frameSize = (version == 3 ? 144 : 72) * bitrate / rate + ((h >>> 9) & 1);
            boolean mono = ((h >>> 6) & 3) == 3;
            int sideInfo = version == 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
            int headerSize = 4 + (((h >>> 16) & 1) == 0 ? 2 : 0);
            if (frameSize <= headerSize + sideInfo || offset + frameSize > end
                    || (streamVersion != -1 && (streamVersion != version || streamRate != rate))) throw invalid();
            byte[] side = read(channel, offset + headerSize, sideInfo).array();
            Bits bits = new Bits(side);
            int back = bits.take(version == 3 ? 9 : 8);
            if (back > precedingMainBytes) throw invalid();
            bits.skip(version == 3 ? (mono ? 5 : 3) : (mono ? 1 : 2));
            if (version == 3) bits.skip(mono ? 4 : 8); // scfsi
            int mainBits = 0;
            for (int granule = 0; granule < (version == 3 ? 2 : 1); granule++) {
                for (int ch = 0; ch < (mono ? 1 : 2); ch++) {
                    mainBits += bits.take(12); // part2_3_length
                    if (bits.take(9) > 288) throw invalid(); // big_values
                    bits.skip(8 + (version == 3 ? 4 : 9));
                    if (bits.take(1) != 0) {
                        if (bits.take(2) == 0) throw invalid();
                        bits.skip(1);
                        checkTable(bits.take(5)); checkTable(bits.take(5));
                        bits.skip(9);
                    } else {
                        checkTable(bits.take(5)); checkTable(bits.take(5)); checkTable(bits.take(5));
                        int region0 = bits.take(4), region1 = bits.take(3);
                        if (region0 + region1 > 20) throw invalid();
                    }
                    bits.skip(version == 3 ? 3 : 2);
                }
            }
            int mainBytes = frameSize - headerSize - sideInfo;
            if (mainBits > (back + mainBytes) * 8) throw invalid();
            precedingMainBytes = Math.min(version == 3 ? 511 : 255, precedingMainBytes + mainBytes);
            streamVersion = version;
            streamRate = rate;
            offset += frameSize;
            frames++;
        }
        if (offset != end || frames < 2) throw invalid();
    }
    private static void checkTable(int table) {
        if (table == 4 || table == 14) throw invalid();
    }
    private static final class Bits {
        private final byte[] bytes;
        private int position;
        Bits(byte[] bytes) { this.bytes = bytes; }
        int take(int count) {
            if (position + count > bytes.length * 8) throw invalid();
            int value = 0;
            for (int i = 0; i < count; i++, position++)
                value = (value << 1) | ((bytes[position / 8] >>> (7 - position % 8)) & 1);
            return value;
        }
        void skip(int count) { take(count); }
    }
    private static ResponseStatusException unsupported() {
        return new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "仅支持实际格式与扩展名一致的 MP3 或 PCM WAV 音乐");
    }
    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "音乐文件为空、已损坏或不是受支持的完整 MP3 / PCM WAV");
    }
}
