package cn.shiguang;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Explicit projections keep original/derived image payloads out of ordinary place operations. */
@Repository
class PlaceRepository {
    record Meta(UUID id, String city, LocalDate visitDate, String description, int sortOrder,
                UUID revision, Integer width, Integer height) {}
    record VariantMeta(UUID placeId, UUID revision, int width, int height, String contentType, String etag) {}
    private static final String COLUMNS = "id,city,visit_date,description,sort_order,image_revision,image_width,image_height";
    private static final RowMapper<Meta> META = (rs, n) -> new Meta(rs.getObject("id", UUID.class),
            rs.getString("city"), rs.getObject("visit_date", LocalDate.class), rs.getString("description"),
            rs.getInt("sort_order"), rs.getObject("image_revision", UUID.class),
            rs.getObject("image_width", Integer.class), rs.getObject("image_height", Integer.class));
    private static final RowMapper<VariantMeta> VARIANT = (rs, n) -> new VariantMeta(
            rs.getObject("place_id", UUID.class), rs.getObject("image_revision", UUID.class),
            rs.getInt("width"), rs.getInt("height"), rs.getString("content_type"), rs.getString("etag"));
    private final JdbcTemplate db;
    PlaceRepository(JdbcTemplate db) { this.db = db; }

    List<Meta> list() { return db.query("SELECT " + COLUMNS + " FROM places ORDER BY sort_order,created_at DESC,id", META); }
    Optional<Meta> find(UUID id) { return query(id, false); }
    Optional<Meta> lock(UUID id) { return query(id, true); }
    private Optional<Meta> query(UUID id, boolean lock) {
        return db.query("SELECT " + COLUMNS + " FROM places WHERE id=?" + (lock ? " FOR UPDATE" : ""), META, id).stream().findFirst();
    }
    List<VariantMeta> variants() {
        return db.query("SELECT v.place_id,v.image_revision,v.width,v.height,v.content_type,v.etag FROM place_image_variants v "
                + "JOIN places p ON p.id=v.place_id AND p.image_revision=v.image_revision ORDER BY v.width", VARIANT);
    }
    List<VariantMeta> variants(UUID id, UUID revision) {
        return db.query("SELECT place_id,image_revision,width,height,content_type,etag FROM place_image_variants "
                + "WHERE place_id=? AND image_revision=? ORDER BY width", VARIANT, id, revision);
    }
    int count() { return db.queryForObject("SELECT count(*) FROM places", Integer.class); }
    void insert(UUID id, PlaceController.Input in, UUID revision) {
        db.update("INSERT INTO places(id,city,name,panorama_image,visit_date,description,sort_order,image_revision) VALUES (?,?,?,?,?,?,?,?)",
                id, in.city(), in.city(), in.panoramaImage(), in.visitDate(), description(in), count(), revision);
    }
    void updateText(UUID id, PlaceController.Input in) {
        db.update("UPDATE places SET city=?,name=?,visit_date=?,description=? WHERE id=?",
                in.city(), in.city(), in.visitDate(), description(in), id);
    }
    void replace(UUID id, String original, UUID revision) {
        db.update("UPDATE places SET panorama_image=?,image_revision=?,image_width=NULL,image_height=NULL,reference_image='',generation_prompt='' WHERE id=?",
                original, revision, id);
        db.update("DELETE FROM place_image_variants WHERE place_id=?", id);
    }
    String original(UUID id, UUID revision) {
        return db.queryForObject("SELECT CASE WHEN panorama_image='' THEN CASE WHEN octet_length(reference_image)<=? THEN reference_image END "
                        + "WHEN octet_length(panorama_image)<=? THEN panorama_image END FROM places WHERE id=? AND image_revision=?",
                String.class, PlaceImageProcessor.MAX_DATA_LENGTH, PlaceImageProcessor.MAX_DATA_LENGTH, id, revision);
    }
    void saveImages(UUID id, UUID revision, PlaceImageProcessor.Prepared image) {
        db.update("UPDATE places SET image_width=?,image_height=? WHERE id=? AND image_revision=?",
                image.width(), image.height(), id, revision);
        for (var variant : image.variants()) {
            db.update("INSERT INTO place_image_variants(place_id,image_revision,width,height,content_type,etag,content) VALUES (?,?,?,?,'image/jpeg',?,?)",
                    id, revision, variant.width(), variant.height(), variant.etag(), variant.bytes());
        }
    }
    Optional<byte[]> content(UUID id, UUID revision, int width) {
        // Current revision in the join prevents an in-flight old URL from receiving replacement bytes.
        return db.query("SELECT v.content FROM place_image_variants v JOIN places p ON p.id=v.place_id AND p.image_revision=v.image_revision "
                + "WHERE v.place_id=? AND v.image_revision=? AND v.width=?", (rs, n) -> rs.getBytes(1), id, revision, width).stream().findFirst();
    }
    void reorder(UUID id, int order) { db.update("UPDATE places SET sort_order=? WHERE id=?", order, id); }
    void delete(UUID id) { db.update("DELETE FROM places WHERE id=?", id); }
    private static String description(PlaceController.Input in) { return in.description() == null ? "" : in.description(); }
}
