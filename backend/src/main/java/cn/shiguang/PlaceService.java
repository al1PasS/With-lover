package cn.shiguang;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;
import java.util.stream.Collectors;

@Service
class PlaceService {
    record Variant(String url, int width, int height) {}
    record Image(String url, Integer width, Integer height, String version, List<Variant> variants) {}
    record View(UUID id, String city, java.time.LocalDate visitDate, String description, int sortOrder, Image image) {}
    private final PlaceRepository repo;
    private final PlaceImageProcessor processor;
    private final ActivityService activity;
    PlaceService(PlaceRepository repo, PlaceImageProcessor processor, ActivityService activity) {
        this.repo = repo; this.processor = processor; this.activity = activity;
    }

    @Transactional(readOnly = true)
    List<View> list(boolean publicly) {
        var variants = repo.variants().stream().collect(Collectors.groupingBy(PlaceRepository.VariantMeta::placeId));
        return repo.list().stream().map(meta -> view(meta, variants.getOrDefault(meta.id(), List.of()), publicly)).toList();
    }
    @Transactional
    View create(PlaceController.Input in) {
        var image = processor.prepare(in.panoramaImage(), true);
        UUID id = UUID.randomUUID(), revision = UUID.randomUUID();
        repo.insert(id, in, revision);
        repo.saveImages(id, revision, image);
        activity.record("places", id.toString(), "created", in.city(), "新增了足迹", ActivityService.route("places", id.toString()));
        return view(required(id), repo.variants(id, revision), false);
    }
    @Transactional
    View update(UUID id, PlaceController.Input in) {
        // Lock the lightweight row before either replacement or derivation; no old original is selected.
        locked(id);
        if (in.panoramaImage() != null) {
            var image = processor.prepare(in.panoramaImage(), true);
            UUID revision = UUID.randomUUID();
            repo.replace(id, in.panoramaImage(), revision);
            repo.saveImages(id, revision, image);
        }
        repo.updateText(id, in);
        activity.record("places", id.toString(), "updated", in.city(), "修改了足迹", ActivityService.route("places", id.toString()));
        var after = required(id);
        return view(after, repo.variants(id, after.revision()), false);
    }
    @Transactional
    void delete(UUID id) {
        var before = locked(id);
        repo.delete(id);
        activity.record("places", id.toString(), "deleted", before.city(), "删除了足迹", ActivityService.route("places", id.toString()));
    }
    @Transactional
    List<View> reorder(List<UUID> ids) {
        if (ids.stream().anyMatch(Objects::isNull) || new HashSet<>(ids).size() != ids.size() || ids.size() != repo.count()) throw changed();
        // Lock in UUID order, matching other row operations without reading original or variant content.
        ids.stream().sorted().forEach(id -> {
            if (repo.lock(id).isEmpty()) throw changed();
        });
        for (int i = 0; i < ids.size(); i++) repo.reorder(ids.get(i), i);
        activity.record("places", "__order__", "updated", "足迹顺序", "调整了城市长卷顺序", "/places");
        return list(false);
    }
    @Transactional(readOnly = true)
    PlaceRepository.Meta metadata(UUID id, UUID version) {
        var meta = required(id);
        verifyVersion(meta, version);
        return meta;
    }
    @Transactional(readOnly = true)
    Optional<PlaceRepository.VariantMeta> variant(PlaceRepository.Meta meta, int width) {
        return select(repo.variants(meta.id(), meta.revision()), width);
    }
    @Transactional
    PlaceRepository.VariantMeta derive(UUID id, UUID revision, int width) {
        var meta = locked(id);
        verifyVersion(meta, revision);
        var existing = select(repo.variants(id, revision), width);
        if (existing.isPresent()) return existing.get();
        // Original is fetched only after the decoder slot and row lock are held; bounded even for legacy data.
        PlaceImageProcessor.Prepared image;
        try { image = processor.prepare(() -> repo.original(id, revision), false); }
        catch (ResponseStatusException error) {
            if (error.getStatusCode().equals(HttpStatus.BAD_REQUEST))
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "历史图片无法安全读取，原图已保留，请管理员重新上传");
            throw error;
        }
        repo.saveImages(id, revision, image);
        return select(repo.variants(id, revision), width).orElseThrow(PlaceService::missing);
    }
    @Transactional(readOnly = true)
    byte[] content(PlaceRepository.VariantMeta variant) {
        return repo.content(variant.placeId(), variant.revision(), variant.width()).orElseThrow(PlaceService::missing);
    }
    private static Optional<PlaceRepository.VariantMeta> select(List<PlaceRepository.VariantMeta> variants, int requested) {
        // A small source only has one deduplicated rendition; never upscale it.
        return variants.stream().filter(v -> v.width() >= requested).findFirst()
                .or(() -> variants.stream().max(Comparator.comparingInt(PlaceRepository.VariantMeta::width)));
    }
    private View view(PlaceRepository.Meta meta, List<PlaceRepository.VariantMeta> variants, boolean publicly) {
        List<Variant> candidates = variants.stream().filter(v -> v.revision().equals(meta.revision()))
                .map(v -> new Variant(url(meta, publicly, bucket(v.width())), v.width(), v.height())).toList();
        Image image = new Image(url(meta, publicly, 1920), meta.width(), meta.height(), meta.revision().toString(), candidates);
        return new View(meta.id(), meta.city(), meta.visitDate(), meta.description(), meta.sortOrder(), image);
    }
    private static int bucket(int width) { return width <= 960 ? 960 : width <= 1920 ? 1920 : 3200; }
    private static String url(PlaceRepository.Meta meta, boolean publicly, int width) {
        return "/api/v1/" + (publicly ? "public/" : "") + "media/places/" + meta.id() + "?w=" + width + "&v=" + meta.revision();
    }
    private PlaceRepository.Meta required(UUID id) { return repo.find(id).orElseThrow(PlaceService::missing); }
    private PlaceRepository.Meta locked(UUID id) { return repo.lock(id).orElseThrow(PlaceService::missing); }
    private static void verifyVersion(PlaceRepository.Meta meta, UUID revision) {
        if (!meta.revision().equals(revision)) throw missing();
    }
    private static ResponseStatusException missing() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "图片或足迹不存在，或图片版本已更新"); }
    private static ResponseStatusException changed() { return new ResponseStatusException(HttpStatus.BAD_REQUEST, "地点列表已经变化，请刷新后重试"); }
}
