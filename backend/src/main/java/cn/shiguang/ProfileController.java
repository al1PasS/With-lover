package cn.shiguang;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import java.security.Principal;

@RestController @RequestMapping("/api/v1/account/profile")
class ProfileController {
 private final ProfileService service;
 ProfileController(ProfileService service){this.service=service;}
 @GetMapping ProfileService.View get(Principal principal){return service.get(principal.getName());}
 @PatchMapping ProfileService.Result update(Principal principal,@Valid @RequestBody ProfileService.Input input,HttpServletRequest request){
  var result=service.update(principal.getName(),input);
  if(result.loginRequired()){
   var session=request.getSession(false);if(session!=null)session.invalidate();
   SecurityContextHolder.clearContext();
  }
  return result;
 }
}
