package cn.shiguang;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.FileSystemResource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.nio.file.Files;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(MusicController.class) @Import(SecurityConfig.class)
class MusicControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean MusicService music;
    @MockitoBean AccountRepository accounts;
    private final UUID id = UUID.randomUUID();
    @Test void anonymousCannotReadSnapshotOrContentEvenWithRange() throws Exception {
        mvc.perform(get("/api/v1/music")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/music/tracks/"+id+"/content").header("Range", "bytes=0-9")).andExpect(status().isUnauthorized());
        mvc.perform(head("/api/v1/music/tracks/"+id+"/content").header("Range", "bytes=0-9")).andExpect(status().isUnauthorized());
        verifyNoInteractions(music);
    }
    @Test void everyWriteRequiresCsrfAndMembersCanManageMusic() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "test.wav", "audio/wav", MusicFixtures.wav());
        mvc.perform(multipart("/api/v1/music/tracks").file(file).with(user("member").roles("MEMBER"))).andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/music/selection").with(user("member")).contentType("application/json").content("{\"trackId\":null}")).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/music/tracks/"+id).with(user("member"))).andExpect(status().isForbidden());
        when(music.upload(any(), any())).thenReturn(new MusicService.Snapshot(List.of(), null, 1, new MusicService.Limits(20971520,20,209715200)));
        mvc.perform(multipart("/api/v1/music/tracks").file(file).param("title","音乐").with(user("member").roles("MEMBER")).with(csrf()))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.revision").value(1)).andExpect(jsonPath("$.limits.maxTracks").value(20));
    }
    @Test void malformedSelectionAndIdsAreFixed400() throws Exception {
        for (String body : new String[]{"{}", "{\"trackId\":123}", "{\"trackId\":\"bad\"}", "null", "{"})
            mvc.perform(put("/api/v1/music/selection").with(user("member")).with(csrf()).contentType("application/json").content(body)).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/v1/music/tracks/not-a-uuid").with(user("member")).with(csrf())).andExpect(status().isBadRequest());
    }
    @Test void multipartOverflowHasFixed413Json() throws Exception {
        when(music.upload(any(), any())).thenThrow(new MaxUploadSizeExceededException(20971520));
        mvc.perform(multipart("/api/v1/music/tracks").file(new MockMultipartFile("file",new byte[]{1})).with(user("member")).with(csrf()))
                .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.code").value("UPLOAD_TOO_LARGE"));
    }
    @Test void resourceSupportsFullPartialSuffixAndUnsatisfiableRanges() throws Exception {
        var path = Files.createTempFile("music-http-", ".wav");
        try {
            byte[] bytes = MusicFixtures.wav(); Files.write(path,bytes);
            when(music.content(id)).thenReturn(new MusicService.Content(new FileSystemResource(path), "audio/wav", bytes.length));
            String url = "/api/v1/music/tracks/"+id+"/content";
            mvc.perform(get(url).with(user("one"))).andExpect(status().isOk()).andExpect(content().bytes(bytes))
                    .andExpect(header().string("Content-Type","audio/wav")).andExpect(header().string("Cache-Control","private, no-store"))
                    .andExpect(header().string("X-Content-Type-Options","nosniff")).andExpect(header().string("Accept-Ranges","bytes"));
            mvc.perform(get(url).with(user("one")).header("Range","bytes=0-9")).andExpect(status().isPartialContent())
                    .andExpect(header().string("Content-Range","bytes 0-9/"+bytes.length)).andExpect(content().bytes(java.util.Arrays.copyOf(bytes,10)));
            mvc.perform(get(url).with(user("one")).header("Range","bytes=-10")).andExpect(status().isPartialContent())
                    .andExpect(content().bytes(java.util.Arrays.copyOfRange(bytes,bytes.length-10,bytes.length)));
            mvc.perform(head(url).with(user("one"))).andExpect(status().isOk()).andExpect(header().string("Content-Length",String.valueOf(bytes.length)));
            for (String range : new String[]{"bytes="+bytes.length+"-", "garbage", "bytes=10-2", "bytes=0-0,2-3", "bytes=-0", "bytes=9999999999999999999999999999-"})
                mvc.perform(get(url).with(user("one")).header("Range",range)).andExpect(status().isRequestedRangeNotSatisfiable())
                        .andExpect(header().string("Content-Range","bytes */"+bytes.length)).andExpect(jsonPath("$.code").value("RANGE_NOT_SATISFIABLE"));
            mvc.perform(head(url).with(user("one")).header("Range","bytes=0-9")).andExpect(status().isPartialContent());
        } finally { Files.deleteIfExists(path); }
    }
}
