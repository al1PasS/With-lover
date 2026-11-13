package cn.shiguang;

import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;

@RestController
@RequestMapping("/api/v1/push")
class WebPushController {
    private final WebPushService push;
    private final ActivityService activity;
    WebPushController(WebPushService push,ActivityService activity) { this.push=push;this.activity=activity; }

    record Configuration(String publicKey,boolean enabled) {}
    record Status(boolean enabled,long unread) {}
    record Input(@NotBlank @Size(max=2048) String endpoint,@NotBlank @Size(max=128) String p256dh,@NotBlank @Size(max=64) String auth) {}

    @GetMapping Configuration config(HttpSession session) { return new Configuration(push.publicKey(),push.enabled(session.getId())); }
    @GetMapping("/status") Status status(HttpSession session,Principal principal) {
        boolean enabled=push.enabled(session.getId());
        return new Status(enabled,enabled?activity.unread(principal.getName()):0);
    }
    @PutMapping @ResponseStatus(HttpStatus.NO_CONTENT)
    void subscribe(HttpSession session,@Valid @RequestBody Input input) {
        push.subscribe(session.getId(),new WebPushService.Subscription(input.endpoint(),input.p256dh(),input.auth()));
    }
    @DeleteMapping @ResponseStatus(HttpStatus.NO_CONTENT) void disable(HttpSession session) { push.disable(session.getId()); }
}
