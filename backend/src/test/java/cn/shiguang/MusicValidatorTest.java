package cn.shiguang;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

class MusicValidatorTest {
    @TempDir Path temp;
    MusicValidator validator = new MusicValidator();
    MusicValidator.Validated validate(byte[] bytes, String name, String type, String title) throws Exception {
        Path path = temp.resolve("synthetic");
        Files.write(path, bytes);
        return validator.validate(path, name, type, title);
    }
    void invalid(byte[] bytes, String name, String mime) {
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> validate(bytes, name, mime, null)).getStatusCode().value());
    }
    @Test void acceptsPcmWavAndCompleteMpegLayerThreeFrames() throws Exception {
        assertEquals("audio/wav", validate(MusicFixtures.wav(), "晴天.WAV", "audio/x-wav", " 我们的音乐 ").contentType());
        assertEquals("我们的音乐", validate(MusicFixtures.wav(), "晴天.wav", "audio/wav", " 我们的音乐 ").title());
        assertEquals("合成", validate(MusicFixtures.mp3(), "合成.mp3", "audio/mpeg", null).title());
    }
    @Test void rejectsNamesPathsControlCharactersAndLongTitles() {
        for (String name : new String[]{"../test.wav", "C:\\test.wav", "a\nb.wav", "\u202etest.wav", "", "x".repeat(252)+".wav"})
            assertThrows(ResponseStatusException.class, () -> validate(MusicFixtures.wav(), name, "audio/wav", null));
        for (String title : new String[]{"../music", "x".repeat(121), "a\u0000b", "\u202e音乐"})
            assertEquals(400, assertThrows(ResponseStatusException.class, () -> validate(MusicFixtures.wav(), "test.wav", "audio/wav", title)).getStatusCode().value());
    }
    @Test void rejectsUnsupportedExtensionsAndMimeSpoofs() {
        assertEquals(415, assertThrows(ResponseStatusException.class, () -> validate(MusicFixtures.wav(), "a.exe", "audio/wav", null)).getStatusCode().value());
        assertEquals(415, assertThrows(ResponseStatusException.class, () -> validate(MusicFixtures.wav(), "a.wav", "text/html", null)).getStatusCode().value());
        invalid(MusicFixtures.wav(), "a.mp3", "audio/mpeg");
        invalid(MusicFixtures.mp3(), "a.wav", "audio/wav");
        invalid("<script>payload</script>".getBytes(), "a.mp3", "audio/mpeg");
    }
    @Test void rejectsEmptyTruncatedAndMalformedWav() {
        invalid(new byte[0], "a.wav", "audio/wav");
        byte[] wav = MusicFixtures.wav();
        for (int length : new int[]{1, 11, 43, wav.length - 1}) invalid(Arrays.copyOf(wav, length), "a.wav", "audio/wav");
        for (int offset : new int[]{4, 16, 20, 22, 24, 28, 32, 34, 40}) {
            byte[] bad = wav.clone(); bad[offset] = (byte)0xff;
            invalid(bad, "a.wav", "audio/wav");
        }
        invalid(MusicFixtures.append(wav, new byte[]{0}), "a.wav", "audio/wav");
    }
    @Test void checksWavChunkPaddingBoundariesAndDuplicateChunks() throws Exception {
        byte[] wav = MusicFixtures.wav();
        byte[] unknown = {'J','U','N','K',1,0,0,0,0,0};
        byte[] withChunk = MusicFixtures.append(Arrays.copyOf(wav, 12), MusicFixtures.append(unknown, Arrays.copyOfRange(wav, 12, wav.length)));
        ByteBuffer.wrap(withChunk).order(ByteOrder.LITTLE_ENDIAN).putInt(4, withChunk.length - 8);
        assertEquals("audio/wav", validate(withChunk, "a.wav", "audio/wav", null).contentType());
        byte[] duplicate = MusicFixtures.append(wav, Arrays.copyOfRange(wav, 12, 36));
        ByteBuffer.wrap(duplicate).order(ByteOrder.LITTLE_ENDIAN).putInt(4, duplicate.length - 8);
        invalid(duplicate, "a.wav", "audio/wav");
    }
    @Test void checksEveryMp3FrameAndRejectsTruncatedAndFreeBitrate() {
        byte[] mp3 = MusicFixtures.mp3();
        invalid(Arrays.copyOf(mp3, mp3.length - 1), "a.mp3", "audio/mpeg");
        invalid(Arrays.copyOf(mp3, 417), "a.mp3", "audio/mpeg");
        for (int offset : new int[]{0, 417, 834}) {
            byte[] bad = mp3.clone(); bad[offset] = 0;
            invalid(bad, "a.mp3", "audio/mpeg");
        }
        byte[] free = mp3.clone(); free[2] = 0;
        invalid(free, "a.mp3", "audio/mpeg");
        invalid(MusicFixtures.append(mp3, new byte[10]), "a.mp3", "audio/mpeg");
    }
    @Test void rejectsInvalidSideInformationAndUnavailableMp3BitReservoir() {
        byte[] unavailable = MusicFixtures.mp3(); unavailable[4] = 1;
        invalid(unavailable, "a.mp3", "audio/mpeg");
        byte[] oversizedMainData = MusicFixtures.mp3();
        // MPEG1 stereo: 20 side-info bits precede the first 12-bit part2_3 length.
        oversizedMainData[6] = 0x0f; oversizedMainData[7] = (byte)0xff;
        invalid(oversizedMainData, "a.mp3", "audio/mpeg");
        byte[] impossibleBigValues = MusicFixtures.mp3();
        impossibleBigValues[8] = (byte)0xff; impossibleBigValues[9] = (byte)0x80;
        invalid(impossibleBigValues, "a.mp3", "audio/mpeg");
    }
    @Test void checksBoundedId3AndOptionalId3v1() throws Exception {
        byte[] tag = {'I','D','3',4,0,0,0,0,0,3,0,0,0};
        assertEquals("audio/mpeg", validate(MusicFixtures.append(tag, MusicFixtures.mp3()), "a.mp3", "audio/mpeg", null).contentType());
        byte[] id3v1 = new byte[128]; id3v1[0]='T'; id3v1[1]='A'; id3v1[2]='G';
        assertEquals("audio/mpeg", validate(MusicFixtures.append(MusicFixtures.mp3(), id3v1), "a.mp3", "audio/mpeg", null).contentType());
        for (byte[] bad : new byte[][]{{'I','D','3',4,0,0,0,0,0,127}, {'I','D','3',4,0,0,(byte)128,0,0,0}, {'I','D','3',4,0,0,1,0,0,0}, {'I','D','3',9,0,0,0,0,0,0}})
            invalid(MusicFixtures.append(bad, MusicFixtures.mp3()), "a.mp3", "audio/mpeg");
    }
}
