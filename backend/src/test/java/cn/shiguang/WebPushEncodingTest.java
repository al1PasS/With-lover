package cn.shiguang;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.Utils;
import org.bouncycastle.jce.interfaces.*;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.jce.spec.ECNamedCurveGenParameterSpec;
import org.jose4j.jws.JsonWebSignature;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.Security;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

class WebPushEncodingTest {
    @Test void buildsSignedAndEncryptedRequestWithoutExposingActivity() throws Exception {
        if (Security.getProvider("BC")==null) Security.addProvider(new BouncyCastleProvider());
        var gen=KeyPairGenerator.getInstance("EC","BC");
        gen.initialize(new ECNamedCurveGenParameterSpec("prime256v1"));
        var vapid=gen.generateKeyPair();
        var recipient=gen.generateKeyPair();
        var b64=Base64.getUrlEncoder().withoutPadding();
        var key=new WebPushService.Vapid(b64.encodeToString(Utils.encode((ECPublicKey)vapid.getPublic())),
            b64.encodeToString(Utils.encode((ECPrivateKey)vapid.getPrivate())));
        String endpoint="https://web.push.apple.com/synthetic-endpoint";
        var encoded=new WebPushService.Encoder(key,"https://test.example.org")
            .encode(new Notification(endpoint,recipient.getPublic(),new byte[16],new byte[]{1},300));
        assertEquals(endpoint,encoded.getUrl());
        assertEquals("aes128gcm",encoded.getHeaders().get("Content-Encoding"));
        assertEquals("300",encoded.getHeaders().get("TTL"));
        assertTrue(encoded.getBody().length>32);
        String jwt=encoded.getHeaders().get("Authorization").split(",")[0].substring("vapid t=".length());
        var signed=new JsonWebSignature();
        signed.setCompactSerialization(jwt);
        signed.setKey(vapid.getPublic());
        assertTrue(signed.verifySignature());
        String claims=new String(Base64.getUrlDecoder().decode(jwt.split("\\.")[1]),StandardCharsets.UTF_8);
        assertTrue(claims.contains("\"aud\":\"https://web.push.apple.com\""));
        assertTrue(claims.contains("\"sub\":\"https://test.example.org\""));
        assertFalse(WebPushService.allowed("https://push.apple.com.example.org/a"));
        assertFalse(WebPushService.allowed("https://web.push.apple.com@127.0.0.1/a"));
        assertFalse(WebPushService.allowed("https://web.push.apple.com:1234/a"));
    }
}
