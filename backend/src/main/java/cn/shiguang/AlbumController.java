package cn.shiguang;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/v1")
class AlbumController {
    private final AlbumService albums;
    private final AlbumImages images;
    private final PrivacyService privacy;
    AlbumController(AlbumService albums,AlbumImages images,PrivacyService privacy) {
        this.albums=albums;this.images=images;this.privacy=privacy;
    }

    @GetMapping("/albums") List<AlbumService.Album> list() { return albums.list(false); }
    @GetMapping("/albums/{id}") AlbumService.Detail detail(@PathVariable String id) { return albums.detail(id,false); }
    @GetMapping("/public/albums") List<AlbumService.Album> publicList() { privacy.requirePublic("albums"); return albums.list(true); }
    @GetMapping("/public/albums/{id}") AlbumService.Detail publicDetail(@PathVariable String id) {
        privacy.requirePublic("albums"); return albums.detail(id,true);
    }
    @PostMapping("/albums") @ResponseStatus(HttpStatus.CREATED)
    AlbumService.Album create(@Valid @RequestBody AlbumService.Input input) { return albums.create(input); }

    @PostMapping(value="/albums/{id}/photos",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    AlbumService.Upload upload(@PathVariable String id,@RequestParam("files") List<MultipartFile> files) {
        if (files.isEmpty() || files.size()>5) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请每批选择 1 至 5 张照片");
        var prepared = new ArrayList<AlbumImages.Image>();
        var rejected = new ArrayList<Integer>();
        for (int i=0;i<files.size();i++) {
            try { prepared.add(images.prepare(files.get(i))); }
            catch (ResponseStatusException error) {
                if (error.getStatusCode()!=HttpStatus.BAD_REQUEST) throw error;
                rejected.add(i);
            }
        }
        return albums.add(id,prepared,rejected);
    }

    record Cover(@NotBlank @Size(max=255) String photoId) {}
    @PutMapping("/albums/{id}/cover") @ResponseStatus(HttpStatus.NO_CONTENT)
    void cover(@PathVariable String id,@Valid @RequestBody Cover input) { albums.cover(id,input.photoId()); }
    @DeleteMapping("/albums/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable String id) { albums.delete(id); }
    @DeleteMapping("/albums/{id}/photos/{photo}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void deletePhoto(@PathVariable String id,@PathVariable String photo) { albums.deletePhoto(id,photo); }

    @GetMapping("/albums/{id}/photos/{photo}")
    ResponseEntity<byte[]> image(@PathVariable String id,@PathVariable String photo,@RequestParam(defaultValue="false") boolean thumbnail) {
        var image=albums.image(id,photo,thumbnail);
        if (image.redirect()!=null) return ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.LOCATION,image.redirect())
            .header(HttpHeaders.CACHE_CONTROL,"private, no-store").build();
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.mime()))
            .header(HttpHeaders.CACHE_CONTROL,"private, no-store").header(HttpHeaders.CONTENT_DISPOSITION,"inline").body(image.content());
    }
    @GetMapping("/public/albums/{id}/photos/{photo}")
    ResponseEntity<byte[]> publicImage(@PathVariable String id,@PathVariable String photo,@RequestParam(defaultValue="false") boolean thumbnail) {
        privacy.requirePublic("albums"); return image(id,photo,thumbnail);
    }
}
