package cn.shiguang;

import nl.martijndwars.webpush.AbstractPushService;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.Utils;
import org.bouncycastle.jce.interfaces.ECPrivateKey;
import org.bouncycastle.jce.interfaces.ECPublicKey;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.jce.spec.ECNamedCurveGenParameterSpec;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.*;
import java.time.Duration;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.*;

@Service
class WebPushService {
    private static final System.Logger LOG = System.getLogger(WebPushService.class.getName());
    private static final byte[] PING = {1}; // The worker fetches the current unread count, with session credentials.
    private final JdbcTemplate db;
    private final String subject;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final ExecutorService sender = new ThreadPoolExecutor(1,2,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(64),r -> {
        Thread thread = new Thread(r,"shiguang-push"); thread.setDaemon(true); return thread;
    },new ThreadPoolExecutor.DiscardPolicy());
    private volatile Vapid key;

    WebPushService(JdbcTemplate db,@org.springframework.beans.factory.annotation.Value("${WEB_PUSH_DOMAIN:}") String domain) {
        this.db = db;
        this.subject = domain.matches("[a-zA-Z0-9.-]+\\.[a-zA-Z0-9-]+") ? "https://" + domain : null;
        if (Security.getProvider("BC")==null) Security.addProvider(new BouncyCastleProvider());
    }

    record Vapid(String publicKey,String privateKey) {}
    record Subscription(String endpoint,String p256dh,String auth) {}

    String publicKey() { return vapid().publicKey(); }
    private Vapid vapid() {
        if (key!=null) return key;
        synchronized (this) {
            if (key!=null) return key;
            var keys=db.query("SELECT public_key,private_key FROM web_push_key",(rs,n)->new Vapid(rs.getString(1),rs.getString(2)));
            if (!keys.isEmpty()) return key=keys.getFirst();
            try {
                var generator=KeyPairGenerator.getInstance("EC","BC");
                generator.initialize(new ECNamedCurveGenParameterSpec("prime256v1"));
                KeyPair pair=generator.generateKeyPair();
                var b64=Base64.getUrlEncoder().withoutPadding();
                db.update("INSERT INTO web_push_key VALUES(true,?,?) ON CONFLICT DO NOTHING",
                    b64.encodeToString(Utils.encode((ECPublicKey)pair.getPublic())),b64.encodeToString(Utils.encode((ECPrivateKey)pair.getPrivate())));
                return key=db.queryForObject("SELECT public_key,private_key FROM web_push_key",(rs,n)->new Vapid(rs.getString(1),rs.getString(2)));
            } catch (GeneralSecurityException e) { throw new IllegalStateException("Web Push key generation failed",e); }
        }
    }

    @Transactional public void subscribe(String session,Subscription input) {
        if (!allowed(input.endpoint())) throw invalid();
        try {
            if (Base64.getUrlDecoder().decode(input.auth()).length!=16 ||
                Base64.getUrlDecoder().decode(input.p256dh()).length!=65) throw invalid();
            Utils.loadPublicKey(input.p256dh());
        } catch (GeneralSecurityException | IllegalArgumentException e) { throw invalid(); }
        var sessions=db.query("SELECT primary_id FROM spring_session WHERE session_id=? AND expiry_time>? FOR UPDATE",
            (rs,n)->rs.getString(1),session,System.currentTimeMillis());
        if (sessions.isEmpty()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"请重新登录");
        String primary=sessions.getFirst();
        db.update("DELETE FROM web_push_subscriptions WHERE session_primary_id=? AND endpoint<>?",primary,input.endpoint());
        db.update("""
            INSERT INTO web_push_subscriptions(endpoint,session_primary_id,p256dh,auth) VALUES(?,?,?,?)
            ON CONFLICT(endpoint) DO UPDATE SET session_primary_id=excluded.session_primary_id,p256dh=excluded.p256dh,auth=excluded.auth
            """,input.endpoint(),primary,input.p256dh(),input.auth());
    }

    boolean enabled(String session) {
        return db.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM web_push_subscriptions w JOIN spring_session s ON s.primary_id=w.session_primary_id
            WHERE s.session_id=? AND s.expiry_time>?)
            """,Boolean.class,session,System.currentTimeMillis());
    }
    void disable(String session) {
        db.update("DELETE FROM web_push_subscriptions WHERE session_primary_id=(SELECT primary_id FROM spring_session WHERE session_id=?)",session);
    }

    @TransactionalEventListener
    void onActivity(ActivityService.Recorded event) { sender.execute(() -> deliver(event.id())); }

    private void deliver(long id) {
        try {
            var targets=db.query("""
                SELECT w.endpoint,w.p256dh,w.auth FROM web_push_subscriptions w
                JOIN spring_session s ON s.primary_id=w.session_primary_id JOIN activity_events e ON e.id=?
                WHERE s.expiry_time>? AND s.principal_name<>e.actor
                AND NOT EXISTS (SELECT 1 FROM activity_reads r WHERE r.event_id=e.id AND r.account=s.principal_name)
                """,(rs,n)->new Subscription(rs.getString(1),rs.getString(2),rs.getString(3)),id,System.currentTimeMillis());
            for (var target:targets) send(target);
        } catch (RuntimeException e) { LOG.log(System.Logger.Level.WARNING,"Could not look up Web Push recipients"); }
    }

    static final class Encoder extends AbstractPushService<Encoder> {
        Encoder(Vapid key,String subject) throws GeneralSecurityException { super(key.publicKey(),key.privateKey(),subject); }
        nl.martijndwars.webpush.HttpRequest encode(Notification notification) throws Exception {
            return prepareRequest(notification,Encoding.AES128GCM);
        }
    }
    private void send(Subscription target) {
        if (!allowed(target.endpoint())) return;
        try {
            var message=new Notification(target.endpoint(),target.p256dh(),target.auth(),PING,300);
            var encoded=new Encoder(vapid(),subject).encode(message);
            if (!allowed(encoded.getUrl())) return;
            var request=HttpRequest.newBuilder(URI.create(encoded.getUrl())).timeout(Duration.ofSeconds(10))
                .header("Topic","shiguang-updates").POST(HttpRequest.BodyPublishers.ofByteArray(encoded.getBody()));
            encoded.getHeaders().forEach(request::header);
            int status=http.send(request.build(),HttpResponse.BodyHandlers.discarding()).statusCode();
            if (status==404 || status==410) db.update("DELETE FROM web_push_subscriptions WHERE endpoint=? AND p256dh=? AND auth=?",
                target.endpoint(),target.p256dh(),target.auth());
            else if (status>=400) LOG.log(System.Logger.Level.WARNING,"Web Push provider returned HTTP {0}",status);
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        catch (Exception e) { LOG.log(System.Logger.Level.WARNING,"Web Push delivery failed"); }
    }

    // A browser-supplied URL must never turn the server into an HTTP proxy.
    static boolean allowed(String endpoint) {
        try {
            URI uri=URI.create(endpoint);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo()!=null || uri.getPort()!=-1 ||
                uri.getFragment()!=null || uri.getHost()==null || uri.getPath()==null || uri.getPath().length()<2) return false;
            String host=uri.getHost().toLowerCase(Locale.ROOT);
            return host.equals("fcm.googleapis.com") || host.equals("updates.push.services.mozilla.com")
                || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
        } catch (IllegalArgumentException e) { return false; }
    }
    @jakarta.annotation.PreDestroy void stop() { sender.shutdownNow(); }
    private static ResponseStatusException invalid() { return new ResponseStatusException(HttpStatus.BAD_REQUEST,"此设备的推送订阅无效或不受支持"); }
}
