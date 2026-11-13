package cn.shiguang;

import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriUtils;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

@Service
class AlbumService {
    private final JdbcTemplate db;
    private final ActivityService activity;
    AlbumService(JdbcTemplate db, ActivityService activity) { this.db = db; this.activity = activity; }

    record Input(@NotBlank @Size(max=80) String title, @NotNull @Size(max=300) String description,
                 @NotNull @Pattern(regexp="event|thing") String category, @NotNull LocalDate date) {}
    record Photo(String id,String src,String thumbnail,String note,String date) {}
    record Album(String id,String title,String description,String category,String date,String coverId,Photo cover,int photoCount) {}
    record Detail(Album album,List<Photo> photos) {}
    record Upload(List<Photo> photos,List<Integer> rejected) {}
    record Image(String mime,byte[] content,String redirect) {}

    List<Album> list(boolean publicRead) {
        return db.query("""
            SELECT c.*,cover.id AS photo_id,cover.photo_date,cover.note,cover.static_src, totals.photo_count
            FROM album_collections c
            CROSS JOIN LATERAL (SELECT count(*) AS photo_count FROM album_photos p WHERE p.album_id=c.id) totals
            LEFT JOIN LATERAL (
                SELECT p.id,p.photo_date,p.note,p.static_src FROM album_photos p WHERE p.album_id=c.id
                ORDER BY (p.id=c.cover_id) DESC NULLS LAST,p.sort_order,p.id LIMIT 1
            ) cover ON true
            ORDER BY c.created_at DESC,c.sort_order,c.id
            """, (rs,n) -> {
            String id = rs.getString("id"), cover = rs.getString("photo_id");
            return new Album(id,rs.getString("title"),rs.getString("description"),rs.getString("category"),
                rs.getString("album_date"),rs.getString("cover_id"),
                cover == null ? null : photo(publicRead,id,cover,rs.getString("note"),rs.getString("photo_date")),rs.getInt("photo_count"));
        });
    }

    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Detail detail(String id,boolean publicRead) {
        // A detail query reads metadata only; image bytes are fetched independently.
        var albums = db.query("SELECT * FROM album_collections WHERE id=?", (rs,n) ->
            new Album(id,rs.getString("title"),rs.getString("description"),rs.getString("category"),
                rs.getString("album_date"),rs.getString("cover_id"),null,0),id);
        if (albums.isEmpty()) throw missing();
        Album album = albums.getFirst();
        var photos = db.query("SELECT id,note,photo_date FROM album_photos WHERE album_id=? ORDER BY sort_order,id",
            (rs,n) -> photo(publicRead,id,rs.getString(1),rs.getString(2),rs.getString(3)),id);
        Photo cover = photos.stream().filter(p -> p.id().equals(album.coverId())).findFirst().orElse(photos.isEmpty() ? null : photos.getFirst());
        return new Detail(new Album(id,album.title(),album.description(),album.category(),album.date(),album.coverId(),cover,photos.size()),photos);
    }

    @Transactional public Album create(Input in) {
        String id=UUID.randomUUID().toString(), title=in.title().strip();
        db.update("INSERT INTO album_collections(id,title,description,category,album_date) VALUES(?,?,?,?,?)",
            id,title,in.description().strip(),in.category(),in.date().toString());
        activity.record("albums",id,"created",title,"新增了相册",ActivityService.route("albums",id));
        return new Album(id,title,in.description().strip(),in.category(),in.date().toString(),null,null,0);
    }

    @Transactional public Upload add(String id,List<AlbumImages.Image> images,List<Integer> rejected) {
        String title = lock(id);
        if (images.isEmpty()) return new Upload(List.of(),rejected);
        long order = db.queryForObject("SELECT COALESCE(max(sort_order),0) FROM album_photos WHERE album_id=?",Long.class,id);
        String date=LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
        List<Photo> added=new ArrayList<>();
        for (var image:images) {
            String photo=UUID.randomUUID().toString();
            db.update("""
                INSERT INTO album_photos(album_id,id,photo_date,mime_type,content,thumbnail,sort_order)
                VALUES(?,?,?,'image/jpeg',?,?,?)
                """,id,photo,date,image.content(),image.thumbnail(),++order);
            added.add(photo(false,id,photo,"",date));
        }
        activity.record("albums",id,"updated",title,"添加了 "+added.size()+" 张照片",
            ActivityService.route("albums",id)+"?activity="+added.getFirst().id());
        return new Upload(added,rejected);
    }

    @Transactional public void cover(String id,String photo) {
        String title=lock(id);
        if (!db.queryForObject("SELECT EXISTS(SELECT 1 FROM album_photos WHERE album_id=? AND id=?)",Boolean.class,id,photo)) throw missing();
        if (db.update("UPDATE album_collections SET cover_id=? WHERE id=? AND cover_id IS DISTINCT FROM ?",photo,id,photo)>0)
            activity.record("albums",id,"updated",title,"更换了相册封面",ActivityService.route("albums",id));
    }

    @Transactional public void deletePhoto(String id,String photo) {
        String title=lock(id);
        if (db.update("DELETE FROM album_photos WHERE album_id=? AND id=?",id,photo)==0) throw missing();
        db.update("UPDATE album_collections SET cover_id=NULL WHERE id=? AND cover_id=?",id,photo);
        activity.record("albums",id,"updated",title,"移除了 1 张照片",ActivityService.route("albums",id));
    }

    @Transactional public void delete(String id) {
        String title=lock(id);
        db.update("DELETE FROM album_collections WHERE id=?",id);
        activity.record("albums",id,"deleted",title,"删除了相册",ActivityService.route("albums",id));
    }

    Image image(String id,String photo,boolean thumbnail) {
        var rows=db.query("""
            SELECT mime_type,CASE WHEN ? THEN COALESCE(thumbnail,content) ELSE content END,static_src
            FROM album_photos WHERE album_id=? AND id=?
            """, (rs,n)->new Image(rs.getString(1),rs.getBytes(2),rs.getString(3)),thumbnail,id,photo);
        if (rows.isEmpty()) throw missing();
        return rows.getFirst();
    }

    private String lock(String id) {
        var rows=db.query("SELECT title FROM album_collections WHERE id=? FOR UPDATE",(rs,n)->rs.getString(1),id);
        if (rows.isEmpty()) throw missing();
        return rows.getFirst();
    }
    private static Photo photo(boolean publicRead,String album,String id,String note,String date) {
        String src="/api/v1"+(publicRead?"/public":"")+"/albums/"+encode(album)+"/photos/"+encode(id);
        return new Photo(id,src,src+"?thumbnail=true",note,date);
    }
    private static String encode(String id) { return UriUtils.encodePathSegment(id, StandardCharsets.UTF_8); }
    private static ResponseStatusException missing() { return new ResponseStatusException(HttpStatus.NOT_FOUND,"相册或照片已删除"); }
}
