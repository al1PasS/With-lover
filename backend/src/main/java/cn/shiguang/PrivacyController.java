package cn.shiguang;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;

@RestController @RequestMapping("/api/v1")
class PrivacyController {
 private final PrivacyService privacy;
 PrivacyController(PrivacyService privacy){this.privacy=privacy;}
 @GetMapping("/public/privacy") PrivacyService.Policy publicPolicy(){return privacy.get();}
 @GetMapping("/admin/privacy") PrivacyService.Policy adminPolicy(){return privacy.get();}
 @PutMapping("/admin/privacy") PrivacyService.Policy save(@Valid @RequestBody PrivacyService.Policy input,Principal principal){return privacy.save(input,principal);}
}
