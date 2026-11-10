package cn.shiguang;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
class PlaceController {
    private final PlaceService places;
    private final PrivacyService privacy;
    PlaceController(PlaceService places, PrivacyService privacy) { this.places = places; this.privacy = privacy; }
    record Input(@NotBlank @Size(max = 100) String city,
                 @Size(max = PlaceImageProcessor.MAX_DATA_LENGTH) String panoramaImage,
                 LocalDate visitDate, @Size(max = 500) String description) {}
    record Reorder(@NotEmpty @Size(max = 1000) List<@NotNull UUID> ids) {}

    @GetMapping("/places") List<PlaceService.View> all() { return places.list(false); }
    @GetMapping("/public/places") List<PlaceService.View> publicAll() {
        privacy.requirePublic("places");
        return places.list(true);
    }
    @PostMapping("/admin/places") @ResponseStatus(HttpStatus.CREATED)
    PlaceService.View create(@Valid @RequestBody Input in) { return places.create(in); }
    @PatchMapping("/admin/places/{id}")
    PlaceService.View update(@PathVariable UUID id, @Valid @RequestBody Input in) { return places.update(id, in); }
    @DeleteMapping("/admin/places/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable UUID id) { places.delete(id); }
    @PatchMapping("/admin/places/reorder")
    List<PlaceService.View> reorder(@Valid @RequestBody Reorder input) { return places.reorder(input.ids()); }
}
