package cn.shiguang;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

/** Small synthetic silence fixtures; no user media or external files. */
final class MusicFixtures {
    private MusicFixtures() {}
    static byte[] wav() { return wav(800); }
    static byte[] wav(int dataBytes) {
        ByteBuffer b = ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN);
        b.put(new byte[]{'R','I','F','F'}).putInt(36 + dataBytes).put(new byte[]{'W','A','V','E'});
        b.put(new byte[]{'f','m','t',' '}).putInt(16).putShort((short)1).putShort((short)1);
        b.putInt(8000).putInt(16000).putShort((short)2).putShort((short)16);
        b.put(new byte[]{'d','a','t','a'}).putInt(dataBytes);
        return b.array();
    }
    static byte[] mp3() {
        byte[] data = new byte[417 * 3];
        for (int offset = 0; offset < data.length; offset += 417) {
            data[offset] = (byte)0xff; data[offset + 1] = (byte)0xfb;
            data[offset + 2] = (byte)0x90; data[offset + 3] = (byte)0x64;
        }
        return data;
    }
    static byte[] append(byte[] first, byte[] next) {
        byte[] result = Arrays.copyOf(first, first.length + next.length);
        System.arraycopy(next, 0, result, first.length, next.length);
        return result;
    }
}
