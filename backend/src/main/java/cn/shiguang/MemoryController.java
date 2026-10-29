package cn.shiguang;
import org.springframework.web.bind.annotation.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.*;
import org.springframework.web.server.ResponseStatusException;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.*;
@RestController @RequestMapping("/api/v1")
class MemoryController {
 private final MemoryRepository repo;private final MemoryService service;private final PrivacyService privacy;
 MemoryController(MemoryRepository repo,MemoryService service,PrivacyService privacy){this.repo=repo;this.service=service;this.privacy=privacy;}
 @GetMapping("/public/memories") List<MemoryService.PublicView> publicList(@RequestParam(defaultValue="0") int page){privacy.requirePublic("timeline");return repo.findByPublishedTrueAndPublicVisibleTrueAndDeletedAtIsNullOrderByDateDesc(PageRequest.of(Math.max(0,page),24)).map(MemoryService::publicView).getContent();}
 @GetMapping("/public/memories/{id}") MemoryService.PublicView publicDetail(@PathVariable UUID id){privacy.requirePublic("timeline");Memory m=repo.findById(id).filter(x->x.published&&x.publicVisible&&x.deletedAt==null).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));return MemoryService.publicView(m);}
 @GetMapping("/memories") List<MemoryService.PrivateView> list(@RequestParam(defaultValue="0") int page){return repo.findByDeletedAtIsNullOrderByDateDesc(PageRequest.of(Math.max(0,page),24)).map(MemoryService::privateView).getContent();}
 @PostMapping("/memories") @ResponseStatus(HttpStatus.CREATED) MemoryService.PrivateView create(@Valid @RequestBody MemoryService.Input in,Principal p){return service.save(null,in,p.getName());}
 @PatchMapping("/memories/{id}") MemoryService.PrivateView update(@PathVariable UUID id,@Valid @RequestBody MemoryService.Input in,Principal p){return service.save(id,in,p.getName());}
 @DeleteMapping("/memories/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) void delete(@PathVariable UUID id){service.trash(id,false);}
 @GetMapping("/trash") List<MemoryService.PrivateView> trash(){return repo.findByDeletedAtIsNotNullOrderByDeletedAtDesc(PageRequest.of(0,100)).map(MemoryService::privateView).getContent();}
 @PostMapping("/trash/{id}/restore") @ResponseStatus(HttpStatus.NO_CONTENT) void restore(@PathVariable UUID id){service.trash(id,true);}
}
