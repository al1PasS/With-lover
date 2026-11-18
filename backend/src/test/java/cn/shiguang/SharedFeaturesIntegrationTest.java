package cn.shiguang;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named="ACTIVITY_DB_TEST",matches="true")
class SharedFeaturesIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired ObjectMapper json;
    @Autowired PasswordEncoder passwords;
    private static final String PASSWORD = "shared-features-test-only";
    private final org.springframework.test.web.servlet.request.RequestPostProcessor one = user("activity-one").roles("ADMIN");
    private final org.springframework.test.web.servlet.request.RequestPostProcessor two = user("activity-two").roles("MEMBER");

    @BeforeEach void seed() {
        db.update("""
            INSERT INTO accounts(id,username,password,nickname,role) VALUES
             (1,'activity-one',?,'合成一','ADMIN'),(2,'activity-two',?,'合成二','MEMBER')
            ON CONFLICT(id) DO NOTHING
            """, passwords.encode(PASSWORD),passwords.encode(PASSWORD));
    }
    private com.fasterxml.jackson.databind.JsonNode body(ResultActions action) throws Exception {
        return json.readTree(action.andReturn().getResponse().getContentAsByteArray());
    }

    @Test @Transactional void keepsAuthorAndPublicationTimeThroughEditsAndAccountRename() throws Exception {
        var input=json.createObjectNode();
        input.put("title","测试回忆").put("body","合成正文").put("date","2020-01-01").put("city","").put("tag","烟火日常")
            .put("image","").put("published",true).put("publicVisible",true).put("publicSummary","摘要").put("version",0);
        var created=body(mvc.perform(post("/api/v1/memories").with(one).with(csrf()).contentType("application/json").content(input.toString())).andExpect(status().isCreated()));
        String path="/api/v1/memories/"+created.path("id").asText();
        String published=created.path("publishedAt").asText();
        assertTrue(Instant.parse(published).isAfter(Instant.now().minusSeconds(10)));
        assertEquals(1,created.path("authorId").asInt());
        input.put("title","对方编辑过").put("version",created.path("version").asInt());
        mvc.perform(patch(path).with(two).with(csrf()).contentType("application/json").content(input.toString()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.authorId").value(1)).andExpect(jsonPath("$.publishedAt").value(published));
        mvc.perform(patch("/api/v1/account/profile").with(one).with(csrf()).contentType("application/json")
            .content("{\"nickname\":\"改后名字\"}")).andExpect(status().isOk());
        mvc.perform(put("/api/v1/admin/privacy").with(one).with(csrf()).contentType("application/json")
            .content("{\"mode\":\"SELECTED\",\"timeline\":true}")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/auth/members").with(two)).andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.id == 1)].name").value(org.hamcrest.Matchers.contains("改后名字")));
        mvc.perform(get(path.replace("/v1/","/v1/public/"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.authorId").doesNotExist()).andExpect(jsonPath("$.publishedAt").doesNotExist());
    }

    @Test @Transactional void homeReadsTwoSmallCardsAndReusesOnlyAuthorizedCurrentThumbnails() throws Exception {
        // Seed legacy rows directly. They predate the thumbnail table and include a transparent photo.
        var png = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(1280, 720, BufferedImage.TYPE_INT_ARGB), "png", png);
        String original = "data:image/png;base64," + Base64.getEncoder().encodeToString(png.toByteArray());
        var ids = new java.util.ArrayList<java.util.UUID>();
        for (int i = 0; i < 25; i++) {
            var id = java.util.UUID.randomUUID();
            db.update("""
                INSERT INTO memories(id,title,body,date,tag,image,published,public_visible,public_summary,updated_at,author_id)
                VALUES(?, ?, ?, date '2090-01-01' + ?, 'test', ?, ?, ?, ?, now(), 1)
                """, id, "test-" + i, "private body ".repeat(100), i, original, i != 23, i != 24, i == 24 ? "" : "public excerpt");
            ids.add(id);
        }
        mvc.perform(get("/api/v1/memories/recent")).andExpect(status().isUnauthorized());
        var member = body(mvc.perform(get("/api/v1/memories/recent").with(one)).andExpect(status().isOk()));
        assertEquals(2, member.size());
        assertEquals(ids.get(24).toString(), member.get(0).get("id").asText());
        assertEquals(160, member.get(0).get("summary").asText().length());
        assertFalse(member.toString().contains("base64"));
        assertFalse(member.get(0).has("body"));
        assertTrue(member.toString().length() < 1200);
        var policy = put("/api/v1/admin/privacy").with(one).with(csrf()).contentType("application/json");
        mvc.perform(policy.content("{\"mode\":\"SELECTED\",\"home\":true,\"timeline\":true}")).andExpect(status().isOk());
        var guest = body(mvc.perform(get("/api/v1/public/memories/recent")).andExpect(status().isOk()));
        assertEquals(2, guest.size());
        assertEquals(ids.get(22).toString(), guest.get(0).get("id").asText());
        assertEquals("public excerpt", guest.get(0).get("summary").asText());
        assertFalse(guest.toString().contains("private body"));
        assertFalse(guest.get(0).has("authorId"));
        assertFalse(guest.get(0).has("publishedAt"));
        mvc.perform(get("/api/v1/memories/order").with(one)).andExpect(jsonPath("$.length()").value(24));
        mvc.perform(get("/api/v1/public/memories/order")).andExpect(jsonPath("$[0]").value(ids.get(22).toString()));
        String privateImage = member.get(0).get("thumbnail").asText();
        mvc.perform(get(privateImage)).andExpect(status().isUnauthorized());
        mvc.perform(get(privateImage.replace("/v1/", "/v1/public/"))).andExpect(status().isNotFound());
        String image = guest.get(0).get("thumbnail").asText();
        var cold = mvc.perform(get(image)).andExpect(status().isOk()).andExpect(content().contentType("image/png"))
            .andExpect(header().string("Cache-Control", "private, no-store")).andReturn().getResponse().getContentAsByteArray();
        var decoded = ImageIO.read(new java.io.ByteArrayInputStream(cold));
        assertEquals(640, decoded.getWidth());
        assertEquals(360, decoded.getHeight());
        assertTrue(decoded.getColorModel().hasAlpha());
        mvc.perform(get(image)).andExpect(content().bytes(cold));
        assertEquals(1, db.queryForObject("SELECT count(*) FROM memory_card_thumbnails WHERE memory_id=?", Integer.class, ids.get(22)));
        mvc.perform(get("/api/v1/public/memories/" + ids.get(22))).andExpect(jsonPath("$.image").value(original));
        db.update("UPDATE memories SET image='', version=version+1 WHERE id=?", ids.get(22));
        mvc.perform(get(image)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/public/memories/recent")).andExpect(jsonPath("$[0].thumbnail").doesNotExist());
        db.update("UPDATE memories SET image=?, version=version+1 WHERE id=?", original, ids.get(22));
        mvc.perform(get(image)).andExpect(status().isNotFound());
        image = body(mvc.perform(get("/api/v1/public/memories/recent"))).get(0).get("thumbnail").asText();
        mvc.perform(get(image)).andExpect(content().bytes(cold));
        assertEquals(2, db.queryForObject("SELECT memory_version FROM memory_card_thumbnails WHERE memory_id=?", Long.class, ids.get(22)));
        db.update("UPDATE memories SET deleted_at=now() WHERE id=?", ids.get(22));
        mvc.perform(get(image)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/public/memories/recent")).andExpect(jsonPath("$[0].id").value(ids.get(21).toString()));
        mvc.perform(policy.content("{\"mode\":\"PRIVATE\"}")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/public/memories/recent")).andExpect(status().isForbidden());
        mvc.perform(get(guest.get(1).get("thumbnail").asText())).andExpect(status().isForbidden());
    }

    @Test @Transactional void validatesCommentAccessAndKeepsLikesPerAccount() throws Exception {
        String value="[{\"id\":\"test-post\",\"type\":\"story\",\"title\":\"合成故事\",\"body\":\"合成正文\",\"authorId\":2,\"publishedAt\":\"2000-01-01T00:00:00Z\"}]";
        var saved=body(mvc.perform(put("/api/v1/settings/messages").with(one).with(csrf()).contentType("application/json")
            .content(json.writeValueAsString(Map.of("value",value)))).andExpect(status().isOk()));
        var post=json.readTree(saved.path("value").asText()).get(0);
        assertEquals(1,post.path("authorId").asInt());
        assertTrue(Instant.parse(post.path("publishedAt").asText()).isAfter(Instant.now().minusSeconds(10)));
        String path="/api/v1/interactions/messages/test-post";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(post(path+"/comments").with(two).contentType("application/json").content("{\"body\":\"无权限\"}")).andExpect(status().isForbidden());
        for(int i=0;i<2;i++) mvc.perform(put(path+"/like").with(two).with(csrf()).contentType("application/json").content("{\"liked\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.likes").value(1));
        mvc.perform(get(path).with(one)).andExpect(status().isOk()).andExpect(jsonPath("$.liked").value(false)).andExpect(jsonPath("$.likes").value(1));
        mvc.perform(post(path+"/comments").with(two).with(csrf()).contentType("application/json").content("{\"body\":\"  我也喜欢  \",\"authorId\":1}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.comments[0].authorId").value(2)).andExpect(jsonPath("$.comments[0].body").value("我也喜欢"));
        mvc.perform(put(path+"/like").with(two).with(csrf()).contentType("application/json").content("{\"liked\":false}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.likes").value(0));
        mvc.perform(get("/api/v1/activities").with(one)).andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].action").value("commented")).andExpect(jsonPath("$.items[1].action").value("liked"));
        mvc.perform(put("/api/v1/settings/messages").with(two).with(csrf()).contentType("application/json")
            .content(json.writeValueAsString(Map.of("value","[]","revision","stale")))).andExpect(status().isConflict());
        mvc.perform(put("/api/v1/settings/messages").with(two).with(csrf()).contentType("application/json")
            .content(json.writeValueAsString(Map.of("value","[]","revision",saved.path("revision").asText())))).andExpect(status().isOk());
        mvc.perform(get(path).with(one)).andExpect(status().isNotFound());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM post_comments WHERE target_id='test-post'",Integer.class));
    }

    @Test @Transactional void albumBatchSkipsCorruptPhotoAndCoverHonorsVisibility() throws Exception {
        var album=body(mvc.perform(post("/api/v1/albums").with(one).with(csrf()).contentType("application/json")
            .content("{\"title\":\"合成相册\",\"description\":\"\",\"category\":\"event\",\"date\":\"2026-11-13\"}")).andExpect(status().isCreated()));
        String path="/api/v1/albums/"+album.path("id").asText();
        var png=new ByteArrayOutputStream();
        assertTrue(ImageIO.write(new BufferedImage(300,120,BufferedImage.TYPE_INT_RGB),"png",png));
        var good=new MockMultipartFile("files","乱码原图.png","image/png",png.toByteArray());
        var bad=new MockMultipartFile("files","bad.png","image/png",new byte[]{0,1,2});
        int limit = 10 * 1024 * 1024;
        var boundary = new MockMultipartFile("files", "boundary.png", "image/png", java.util.Arrays.copyOf(png.toByteArray(), limit));
        var oversized = new MockMultipartFile("files", "oversized.png", "image/png", java.util.Arrays.copyOf(png.toByteArray(), limit + 1));
        mvc.perform(multipart(path+"/photos").file(good)).andExpect(status().isUnauthorized());
        var uploaded=body(mvc.perform(multipart(path+"/photos").file(boundary).file(bad).file(good).file(oversized).with(one).with(csrf()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.photos.length()").value(2)).andExpect(jsonPath("$.rejected[0]").value(1))
            .andExpect(jsonPath("$.rejected[1]").value(3))
            .andExpect(jsonPath("$.photos[0].title").doesNotExist()));
        String first=uploaded.path("photos").get(0).path("id").asText(), cover=uploaded.path("photos").get(1).path("id").asText();
        mvc.perform(get("/api/v1/activities").with(two)).andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].photoUpdate.kind").value("added"))
            .andExpect(jsonPath("$.items[0].photoUpdate.photoIds[0]").value(first))
            .andExpect(jsonPath("$.items[0].photoUpdate.photoIds[1]").value(cover));
        String image=uploaded.path("photos").get(1).path("thumbnail").asText();
        mvc.perform(get(java.net.URI.create(image)).with(two)).andExpect(status().isOk()).andExpect(content().contentType("image/jpeg"))
            .andExpect(header().string("Cache-Control","private, no-store")).andExpect(header().string("Content-Disposition","inline"));
        mvc.perform(get(java.net.URI.create(image))).andExpect(status().isUnauthorized());
        mvc.perform(put(path+"/cover").with(two).with(csrf()).contentType("application/json").content(json.writeValueAsString(Map.of("photoId",cover))))
            .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/activities").with(one)).andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].photoUpdate.kind").value("cover"))
            .andExpect(jsonPath("$.items[0].photoUpdate.photoIds[0]").value(cover));
        mvc.perform(get("/api/v1/albums").with(one)).andExpect(status().isOk()).andExpect(jsonPath("$[0].cover.id").value(cover));
        String publicImage=image.replace("/v1/","/v1/public/");
        var privacy=new PrivacyService.Policy("SELECTED",true,true,false,true,false);
        mvc.perform(put("/api/v1/admin/privacy").with(one).with(csrf()).contentType("application/json").content(json.writeValueAsString(privacy)))
            .andExpect(status().isOk());
        mvc.perform(get(java.net.URI.create(publicImage))).andExpect(status().isOk());
        mvc.perform(put("/api/v1/admin/privacy").with(one).with(csrf()).contentType("application/json").content("{\"mode\":\"PRIVATE\"}"))
            .andExpect(status().isOk());
        mvc.perform(get(java.net.URI.create(publicImage)).header("If-None-Match","\"old\"")).andExpect(status().isForbidden());
        mvc.perform(delete(path+"/photos/"+cover).with(one).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get(path).with(two)).andExpect(status().isOk()).andExpect(jsonPath("$.album.cover.id").value(first));
    }

    @Test void cookieSurvivesBrowserRestartAndLogoutUnsubscribesSession() throws Exception {
        db.update("UPDATE accounts SET password=? WHERE username='activity-two'",passwords.encode(PASSWORD));
        var seed=mvc.perform(get("/api/v1/auth/csrf")).andExpect(status().isOk()).andReturn().getResponse();
        var login=mvc.perform(post("/api/v1/auth/login").cookie(seed.getCookies())
            .header("X-CSRF-TOKEN",json.readTree(seed.getContentAsByteArray()).path("token").asText())
            .contentType("application/json").content(json.writeValueAsString(Map.of("username","activity-two","password",PASSWORD))))
            .andExpect(status().isOk()).andReturn().getResponse();
        var cookie=login.getCookie("SESSION");
        assertNotNull(cookie); assertEquals(LoginCookie.LIFETIME,cookie.getMaxAge()); assertTrue(cookie.isHttpOnly());
        assertTrue(login.getHeader("Set-Cookie").contains("SameSite=Lax"));
        Cookie reopened=new Cookie(cookie.getName(),cookie.getValue());
        var configuration=body(mvc.perform(get("/api/v1/push").cookie(reopened)).andExpect(status().isOk()));
        var push=Map.of("endpoint","https://fcm.googleapis.com/fcm/send/synthetic-no-delivery",
            "p256dh",configuration.path("publicKey").asText(),"auth",Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]));
        var csrf=body(mvc.perform(get("/api/v1/auth/csrf").cookie(reopened)).andExpect(status().isOk())).path("token").asText();
        mvc.perform(put("/api/v1/push").cookie(reopened).header("X-CSRF-TOKEN",csrf).contentType("application/json")
            .content(json.writeValueAsString(push))).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/push/status").cookie(reopened)).andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true));
        mvc.perform(post("/api/v1/auth/logout").cookie(reopened).header("X-CSRF-TOKEN",csrf)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/push/status").cookie(reopened)).andExpect(status().isUnauthorized());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM web_push_subscriptions WHERE endpoint=?",Integer.class,push.get("endpoint")));
    }

    @Test @Transactional void photoOrderIsPrivateAtomicAndPreservesExplicitCover() throws Exception {
        String id = java.util.UUID.randomUUID().toString();
        db.update("INSERT INTO album_collections(id,title,description,category,album_date,cover_id) VALUES(?,?,'','event','2026-11-14','b')", id, "排序测试");
        for (int i = 0; i < 3; i++) {
            String photo = String.valueOf((char) ('a' + i));
            db.update("""
                INSERT INTO album_photos(album_id,id,photo_date,static_src,sort_order)
                VALUES(?,?,'2026-11-14','/images/cover.webp',?)
                """, id, photo, (i + 1) * 10);
        }
        String path = "/api/v1/albums/" + id + "/photos/order";
        String original = "[\"a\",\"b\",\"c\"]";
        String reordered = "[\"c\",\"a\",\"b\"]";
        java.util.function.BiFunction<String, String, String> payload = (before, after) ->
            "{\"previousPhotoIds\":" + before + ",\"photoIds\":" + after + "}";
        var update = put(path).contentType("application/json").content(payload.apply(original, reordered));
        mvc.perform(put(path).with(csrf()).contentType("application/json").content(payload.apply(original, reordered)))
            .andExpect(status().isUnauthorized());
        mvc.perform(update.with(two)).andExpect(status().isForbidden());
        mvc.perform(put(path).with(two).with(csrf()).contentType("application/json")
            .content(payload.apply(original, "[\"a\",\"a\",\"foreign\"]")))
            .andExpect(status().isBadRequest());
        for (int i = 0; i < 2; i++) {
            mvc.perform(put(path).with(two).with(csrf()).contentType("application/json").content(payload.apply(original, reordered)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.photos[0].id").value("c"))
                .andExpect(jsonPath("$.album.cover.id").value("b"));
        }
        mvc.perform(put(path).with(one).with(csrf()).contentType("application/json")
            .content(payload.apply(original, "[\"b\",\"c\",\"a\"]"))).andExpect(status().isConflict());
        mvc.perform(get("/api/v1/albums/" + id).with(one)).andExpect(status().isOk())
            .andExpect(jsonPath("$.photos[0].id").value("c")).andExpect(jsonPath("$.photos[1].id").value("a"))
            .andExpect(jsonPath("$.photos[2].id").value("b"));
        assertEquals(1, db.queryForObject("""
            SELECT count(*) FROM activity_events WHERE module='albums' AND target_id=? AND summary='调整了照片顺序'
            """, Integer.class, id));
    }
}
