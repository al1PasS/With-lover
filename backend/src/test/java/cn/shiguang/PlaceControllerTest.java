package cn.shiguang;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest({PlaceController.class, PlaceMediaController.class})
@Import({SecurityConfig.class, PlaceCacheFilter.class})
class PlaceControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean PlaceService places;
    @MockitoBean PrivacyService privacy;
    @MockitoBean AccountRepository accounts;
    final UUID id = UUID.randomUUID(), revision = UUID.randomUUID();
    final String etag = "\"synthetic-image\"";
    PlaceRepository.Meta meta() { return new PlaceRepository.Meta(id, "合成城市", null, "合成说明", 0, revision, 3500, 500); }
    PlaceRepository.VariantMeta variant() { return new PlaceRepository.VariantMeta(id, revision, 1920, 274, "image/jpeg", etag); }
    String url(boolean publicly) { return "/api/v1/" + (publicly ? "public/" : "") + "media/places/" + id + "?w=1920&v=" + revision; }
    void stubImage() {
        when(places.metadata(id, revision)).thenReturn(meta());
        when(places.variant(meta(), 1920)).thenReturn(Optional.of(variant()));
        when(places.content(variant())).thenReturn(new byte[]{1, 2, 3});
    }
    @Test void privateEndpointsRequireLoginAndAdminWritesRequireRoleAndCsrf() throws Exception {
        mvc.perform(get(url(false))).andExpect(status().isUnauthorized()).andExpect(header().string("Cache-Control", "private, no-store"));
        mvc.perform(get("/api/v1/places")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/admin/places").with(user("member").roles("MEMBER")).with(csrf()).contentType("application/json").content("{}"))
                .andExpect(status().isForbidden()).andExpect(header().string("Cache-Control", "private, no-store"));
        mvc.perform(post("/api/v1/admin/places").with(user("admin").roles("ADMIN")).contentType("application/json").content("{}"))
                .andExpect(status().isForbidden()).andExpect(header().string("Cache-Control", "private, no-store"));
    }
    @Test void privateImagesIgnoreConditionalHeadersAndNeverReturnEtag() throws Exception {
        stubImage();
        mvc.perform(get(url(false)).with(user("member")).header("If-None-Match", etag))
                .andExpect(status().isOk()).andExpect(content().bytes(new byte[]{1, 2, 3}))
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(header().doesNotExist("ETag")).andExpect(content().contentType("image/jpeg"));
    }
    @Test void publicConditionalHitChecksPermissionAndLightweightMetadataButNeverReadsBytes() throws Exception {
        stubImage();
        mvc.perform(get(url(true)).header("If-None-Match", "\"other\", W/" + etag))
                .andExpect(status().isNotModified()).andExpect(header().string("Cache-Control", "private, no-cache"))
                .andExpect(header().string("ETag", etag)).andExpect(content().string(""));
        var ordered = inOrder(privacy, places);
        ordered.verify(privacy).requirePublic("places");
        ordered.verify(places).metadata(id, revision);
        ordered.verify(places).variant(meta(), 1920);
        verify(places, never()).content(any());
        verify(places, never()).derive(any(), any(), anyInt());
    }
    @Test void revokingPublicAccessRejectsPreviouslyCachedEtagBeforeMetadataLookup() throws Exception {
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(privacy).requirePublic("places");
        mvc.perform(get(url(true)).header("If-None-Match", etag)).andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "private, no-store")).andExpect(header().doesNotExist("ETag"));
        verifyNoInteractions(places);
    }
    @Test void missingAndStaleVersionNeverReturn304() throws Exception {
        when(places.metadata(id, revision)).thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND));
        mvc.perform(get(url(true)).header("If-None-Match", "*")).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "private, no-store")).andExpect(header().doesNotExist("ETag"));
        verify(places, never()).variant(any(), anyInt());
    }
    @Test void lazyGenerationAlwaysReturns200AndNextRequestCanRevalidate() throws Exception {
        when(places.metadata(id, revision)).thenReturn(meta());
        when(places.variant(meta(), 1920)).thenReturn(Optional.empty());
        when(places.derive(id, revision, 1920)).thenReturn(variant());
        when(places.content(variant())).thenReturn(new byte[]{4});
        for (String conditional : List.of("*", etag)) {
            mvc.perform(get(url(true)).header("If-None-Match", conditional)).andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "private, no-cache")).andExpect(content().bytes(new byte[]{4}));
        }
    }
    @Test void contentDisappearingAfterMetadataLeavesNoStoreErrorWithoutEtag() throws Exception {
        stubImage();
        when(places.content(variant())).thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND));
        mvc.perform(get(url(true))).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "private, no-store")).andExpect(header().doesNotExist("ETag"));
    }
    @Test void invalidQueriesAndHeadDoNotTriggerImageWork() throws Exception {
        mvc.perform(get(url(true).replace("w=1920", "w=123"))).andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "private, no-store"));
        mvc.perform(get("/api/v1/public/media/places/" + id)).andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "private, no-store"));
        mvc.perform(head(url(true))).andExpect(status().isMethodNotAllowed()).andExpect(header().string("Cache-Control", "private, no-store"));
        verifyNoInteractions(places);
    }
    @Test void listsAreLightweightAndPrivateEvenWhenPubliclyVisible() throws Exception {
        var image = new PlaceService.Image(url(true), null, null, revision.toString(), List.of());
        when(places.list(true)).thenReturn(List.of(new PlaceService.View(id, "城市", null, "说明", 0, image)));
        mvc.perform(get("/api/v1/public/places")).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(jsonPath("$[0].panoramaImage").doesNotExist())
                .andExpect(jsonPath("$[0].image.version").value(revision.toString()))
                .andExpect(jsonPath("$[0].image.variants").isEmpty());
    }
    @Test void patchAcceptsOmittedOrNullImageAndValidatesText() throws Exception {
        for (String body : List.of("{\"city\":\"城市\"}", "{\"city\":\"城市\",\"panoramaImage\":null}")) {
            mvc.perform(patch("/api/v1/admin/places/" + id).with(user("admin").roles("ADMIN")).with(csrf()).contentType("application/json").content(body))
                    .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "private, no-store"));
        }
        verify(places, times(2)).update(eq(id), argThat(in -> in.panoramaImage() == null));
        mvc.perform(patch("/api/v1/admin/places/" + id).with(user("admin").roles("ADMIN")).with(csrf()).contentType("application/json").content("{\"city\":\"\"}"))
                .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "private, no-store"));
    }
}
