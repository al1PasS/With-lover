package cn.shiguang;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.security.Principal;
import java.time.Instant;
import java.util.Set;

@RestController @RequestMapping("/api/v1")
class SiteSettingController {
 private static final Set<String> KEYS=Set.of("cover","messages","wishes","garden","gacha","albums");
 private final SiteSettingRepository repo;
 private final PrivacyService privacy;
 SiteSettingController(SiteSettingRepository repo,PrivacyService privacy){this.repo=repo;this.privacy=privacy;}
 record Value(@NotNull @Size(max=50_000_000) String value){}
 private void valid(String key){if(!KEYS.contains(key))throw new ResponseStatusException(HttpStatus.NOT_FOUND);}
 @GetMapping("/public/settings/cover") Value publicCover(){privacy.requirePublic("home");return new Value(repo.findById("cover").map(x->x.value).orElse(""));}
 @GetMapping("/public/settings/albums") Value publicAlbums(){privacy.requirePublic("albums");return new Value(repo.findById("albums").map(x->x.value).orElse(""));}
 @GetMapping("/settings/{key}") Value get(@PathVariable String key){valid(key);return new Value(repo.findById(key).map(x->x.value).orElse(""));}
 @PutMapping("/settings/{key}") Value put(@PathVariable String key,@Valid @RequestBody Value input,Principal principal){
  valid(key);
  SiteSetting item=repo.findById(key).orElseGet(()->new SiteSetting(key,input.value(),principal.getName()));
  item.value=input.value();item.updatedAt=Instant.now();item.updatedBy=principal.getName();repo.save(item);
  return input;
 }
}
