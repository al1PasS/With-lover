package cn.shiguang;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PlaceServiceTest {
    final PlaceRepository repo = mock(PlaceRepository.class);
    final PlaceImageProcessor processor = mock(PlaceImageProcessor.class);
    final ActivityService activity = mock(ActivityService.class);
    final PlaceService service = new PlaceService(repo, processor, activity);
    final UUID id = UUID.randomUUID(), revision = UUID.randomUUID();
    final PlaceRepository.Meta meta = new PlaceRepository.Meta(id, "城市", null, "说明", 2, revision, 700, 100);
    final PlaceRepository.VariantMeta variant = new PlaceRepository.VariantMeta(id, revision, 700, 100, "image/jpeg", "\"etag\"");
    @BeforeEach void stub() {
        when(repo.find(id)).thenReturn(Optional.of(meta));
        when(repo.lock(id)).thenReturn(Optional.of(meta));
        when(repo.variants(id, revision)).thenReturn(List.of(variant));
    }
    @Test void omittedImageOnlyUpdatesTextWithoutLoadingOrRewritingOriginal() {
        var input = new PlaceController.Input("新城市", null, null, "新说明");
        var result = service.update(id, input);
        assertEquals(revision.toString(), result.image().version());
        verify(repo).updateText(id, input);
        verify(repo, never()).original(any(), any());
        verify(repo, never()).replace(any(), any(), any());
        verifyNoInteractions(processor);
        verify(activity).record(eq("places"), eq(id.toString()), eq("updated"), eq("新城市"), anyString(), anyString());
    }
    @Test void metadataAndListsAreExplicitLightweightProjectionsAndActualSizeUrls() {
        when(repo.list()).thenReturn(List.of(meta));
        when(repo.variants()).thenReturn(List.of(variant));
        var result = service.list(true).getFirst();
        assertEquals(700, result.image().width());
        assertEquals(700, result.image().variants().getFirst().width());
        assertTrue(result.image().url().contains("/public/media/places/"));
        assertTrue(result.image().url().contains("?w=1920&v="));
        assertTrue(result.image().variants().getFirst().url().contains("?w=960&v="));
        assertEquals(meta, service.metadata(id, revision));
        verify(repo, never()).original(any(), any());
        verify(repo, never()).content(any(), any(), anyInt());
    }
    @Test void staleVersionRejectedBeforeReadingVariantsOrOriginal() {
        var error = assertThrows(ResponseStatusException.class, () -> service.metadata(id, UUID.randomUUID()));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
        assertThrows(ResponseStatusException.class, () -> service.derive(id, UUID.randomUUID(), 960));
        verify(repo, never()).original(any(), any());
        verify(repo, never()).variants(any(), any());
    }
    @Test void existingDerivationIsReusedWithoutDecodingOrActivity() {
        assertEquals(variant, service.derive(id, revision, 3200));
        verifyNoInteractions(processor, activity);
        verify(repo, never()).original(any(), any());
    }
    @Test void legacyDerivationChecksRowLockAndVersionAndLoadsOriginalOnlyInsideDecoderSlot() {
        when(repo.variants(id, revision)).thenReturn(List.of(), List.of(variant));
        var prepared = new PlaceImageProcessor.Prepared(700, 100, List.of());
        when(processor.prepare(anySupplier(), eq(false))).thenAnswer(invocation -> {
            Supplier<String> supplier = invocation.getArgument(0);
            assertEquals("legacy", supplier.get());
            return prepared;
        });
        when(repo.original(id, revision)).thenReturn("legacy");
        assertEquals(variant, service.derive(id, revision, 1920));
        var ordered = inOrder(repo, processor);
        ordered.verify(repo).lock(id);
        ordered.verify(repo).variants(id, revision);
        ordered.verify(processor).prepare(anySupplier(), eq(false));
        ordered.verify(repo).original(id, revision);
        ordered.verify(repo).saveImages(id, revision, prepared);
        verifyNoInteractions(activity);
    }
    @Test void replacingImageUsesNewRevisionAndNeverLoadsOldImage() {
        var prepared = new PlaceImageProcessor.Prepared(700, 100, List.of());
        when(processor.prepare("new", true)).thenReturn(prepared);
        service.update(id, new PlaceController.Input("城市", "new", null, ""));
        var capture = ArgumentCaptor.forClass(UUID.class);
        verify(repo).replace(eq(id), eq("new"), capture.capture());
        assertNotEquals(revision, capture.getValue());
        verify(repo).saveImages(id, capture.getValue(), prepared);
        verify(repo, never()).original(any(), any());
    }
    @Test void deletingAndSortingNeverLoadImagePayloadsAndRejectDuplicateIds() {
        service.delete(id);
        verify(repo).delete(id);
        when(repo.list()).thenReturn(List.of(meta));
        when(repo.variants()).thenReturn(List.of(variant));
        when(repo.count()).thenReturn(1);
        service.reorder(List.of(id));
        verify(repo).reorder(id, 0);
        assertThrows(ResponseStatusException.class, () -> service.reorder(List.of(id, id)));
        verify(repo, never()).original(any(), any());
        verifyNoInteractions(processor);
    }
    @Test void reorderRejectsMissingPlacesBeforeChangingAnyOrderOrRecordingActivity() {
        when(repo.count()).thenReturn(2);
        assertThrows(ResponseStatusException.class, () -> service.reorder(List.of(id)));
        verify(repo, never()).reorder(any(), anyInt());
        verify(repo, never()).lock(any());
        verifyNoInteractions(activity);
    }
    @Test void newPlaceNeedsAnImageAndEmptyOrPreviewUrlReplacementIsRejected() {
        var real = new PlaceService(repo, new PlaceImageProcessor(), activity);
        assertThrows(ResponseStatusException.class, () -> real.create(new PlaceController.Input("城市", null, null, "")));
        for (String invalid : List.of("", "/api/v1/media/places/" + id + "?w=1920&v=" + revision)) {
            assertThrows(ResponseStatusException.class, () -> real.update(id, new PlaceController.Input("城市", invalid, null, "")));
        }
        verify(repo, never()).replace(any(), any(), any());
        verify(repo, never()).updateText(any(), any());
        verifyNoInteractions(activity);
    }
    @SuppressWarnings("unchecked")
    private static Supplier<String> anySupplier() { return any(Supplier.class); }
}
