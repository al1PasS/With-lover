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
        mvc.perform(multipart(path+"/photos").file(good)).andExpect(status().isUnauthorized());
        var uploaded=body(mvc.perform(multipart(path+"/photos").file(good).file(bad).file(good).with(one).with(csrf()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.photos.length()").value(2)).andExpect(jsonPath("$.rejected[0]").value(1))
            .andExpect(jsonPath("$.photos[0].title").doesNotExist()));
        String first=uploaded.path("photos").get(0).path("id").asText(), cover=uploaded.path("photos").get(1).path("id").asText();
        String image=uploaded.path("photos").get(1).path("thumbnail").asText();
        mvc.perform(get(java.net.URI.create(image)).with(two)).andExpect(status().isOk()).andExpect(content().contentType("image/jpeg"))
            .andExpect(header().string("Cache-Control","private, no-store")).andExpect(header().string("Content-Disposition","inline"));
        mvc.perform(get(java.net.URI.create(image))).andExpect(status().isUnauthorized());
        mvc.perform(put(path+"/cover").with(two).with(csrf()).contentType("application/json").content(json.writeValueAsString(Map.of("photoId",cover))))
            .andExpect(status().isNoContent());
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
}
