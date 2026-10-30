package cn.shiguang;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.util.DigestUtils;
import org.springframework.web.context.request.WebRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.security.Principal;
import java.time.Instant;
import java.util.Set;
import java.util.Base64;

@RestController @RequestMapping("/api/v1")
class SiteSettingController {
 private static final Set<String> KEYS=Set.of("cover","messages","wishes","garden","gacha","albums");
 private final SiteSettingRepository repo;
 private final PrivacyService privacy;
 SiteSettingController(SiteSettingRepository repo,PrivacyService privacy){this.repo=repo;this.privacy=privacy;}
 record Value(@NotNull @Size(max=50_000_000) String value){}
 private void valid(String key){if(!KEYS.contains(key))throw new ResponseStatusException(HttpStatus.NOT_FOUND);}
 @GetMapping("/public/settings/cover") Value publicCover(){privacy.requirePublic("home");return new Value(repo.findById("cover").map(x->x.value).orElse(""));}
 @GetMapping("/public/media/cover") ResponseEntity<byte[]> publicCoverImage(WebRequest request){
  // Check visibility before conditional requests, including cached responses.
  privacy.requirePublic("home");return coverImage(request);
 }
 @GetMapping("/media/cover") ResponseEntity<byte[]> coverImage(WebRequest request){
  String raw=repo.findById("cover").map(x->x.value).orElse("");
  if(raw.isBlank())return ResponseEntity.status(302).header("Location","/images/cover.webp").header("Cache-Control","private, no-cache").build();
  try {
   String data=new ObjectMapper().readValue(raw,String.class);
   int comma=data.indexOf(',');
   String header=comma<0?"":data.substring(0,comma);
   if(!Set.of("data:image/webp;base64","data:image/jpeg;base64","data:image/png;base64","data:image/gif;base64").contains(header))
    throw new IllegalArgumentException("Unsupported cover format");
   String etag="\""+DigestUtils.md5DigestAsHex(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8))+"\"";
   if(request.checkNotModified(etag))return ResponseEntity.status(304).header("ETag",etag).header("Cache-Control","private, no-cache").build();
   byte[] bytes=Base64.getDecoder().decode(data.substring(comma+1));
   return ResponseEntity.ok().header("Cache-Control","private, no-cache").eTag(etag)
    .contentType(MediaType.parseMediaType(header.substring(5,header.indexOf(';')))).body(bytes);
  } catch(Exception e){throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"封面图片格式无效",e);}
 }
 @GetMapping("/public/settings/albums") Value publicAlbums(){privacy.requirePublic("albums");return new Value(repo.findById("albums").map(x->x.value).orElse(""));}
 @GetMapping("/settings/{key}") Value get(@PathVariable String key){valid(key);return new Value(repo.findById(key).map(x->x.value).orElse(""));}
 @PutMapping("/settings/{key}") Value put(@PathVariable String key,@Valid @RequestBody Value input,Principal principal){
  valid(key);
  SiteSetting item=repo.findById(key).orElseGet(()->new SiteSetting(key,input.value(),principal.getName()));
  item.value=input.value();item.updatedAt=Instant.now();item.updatedBy=principal.getName();repo.save(item);
  return input;
 }
}
