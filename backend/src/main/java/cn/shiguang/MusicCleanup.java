package cn.shiguang;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
@EnableScheduling
class MusicCleanup {
    private final MusicService music;
    MusicCleanup(MusicService music) { this.music = music; }
    @EventListener(ApplicationReadyEvent.class)
    void onReady() { music.collectOrphans(); }
    @Scheduled(initialDelayString = "${shiguang.music.cleanup-interval:PT1H}", fixedDelayString = "${shiguang.music.cleanup-interval:PT1H}")
    void periodically() { music.collectOrphans(); }
}
