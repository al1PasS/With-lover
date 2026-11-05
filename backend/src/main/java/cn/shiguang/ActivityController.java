package cn.shiguang;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.PositiveOrZero;
import java.security.Principal;
@RestController @RequestMapping("/api/v1/activities")
class ActivityController {
 private final ActivityService service;
 ActivityController(ActivityService service){this.service=service;}
 @GetMapping ActivityService.Feed list(Principal p,@RequestParam(defaultValue="false") boolean all,@RequestParam(required=false) Long before){return service.feed(p.getName(),all,before);}
 @PostMapping("/{id}/read") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) void read(Principal p,@PathVariable long id){service.read(p.getName(),id);}
 record Through(@PositiveOrZero long throughId){}
 @PostMapping("/read-all") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) void all(Principal p,@Valid @RequestBody Through input){service.readAll(p.getName(),input.throughId());}
}
