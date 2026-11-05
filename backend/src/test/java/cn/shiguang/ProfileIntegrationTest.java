package cn.shiguang;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;

@SpringBootTest @AutoConfigureMockMvc @Transactional
@EnabledIfEnvironmentVariable(named="ACTIVITY_DB_TEST",matches="true")
class ProfileIntegrationTest {
 @Autowired MockMvc mvc;
 @Autowired JdbcTemplate db;
 @Autowired PasswordEncoder encoder;
 @Autowired ProfileService service;
 @BeforeEach void seed(){
  db.update("INSERT INTO accounts(id,username,password,nickname,role) VALUES (1,'activity-one',?,'测试甲','ADMIN'),(2,'activity-two',?,'测试乙','MEMBER') ON CONFLICT(id) DO UPDATE SET password=excluded.password,nickname=excluded.nickname",encoder.encode("original-test-only"),encoder.encode("original-test-only"));
 }
 @AfterEach void clear(){SecurityContextHolder.clearContext();}
 @Test void oldPasswordIsRequiredAndWrongPasswordChangesNothing()throws Exception{
  mvc.perform(patch("/api/v1/account/profile").with(user("activity-one")).with(csrf()).contentType("application/json").content("{\"nickname\":\"不应保存\",\"oldPassword\":\"incorrect\",\"newPassword\":\"replacement-test-only\"}"))
   .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("旧密码不正确"));
  assertEquals("测试甲",service.get("activity-one").nickname());
  assertTrue(encoder.matches("original-test-only",db.queryForObject("SELECT password FROM accounts WHERE id=1",String.class)));
  mvc.perform(patch("/api/v1/account/profile").with(user("activity-one")).with(csrf()).contentType("application/json").content("{\"newPassword\":\"replacement-test-only\"}"))
   .andExpect(status().isBadRequest());
 }
 @Test void nicknameOnlyChangeKeepsOtherAccountAndReturnsNoSecrets()throws Exception{
  mvc.perform(patch("/api/v1/account/profile").with(user("activity-one")).with(csrf()).contentType("application/json").content("{\"nickname\":\" 新昵称 \"}"))
   .andExpect(status().isOk()).andExpect(jsonPath("$.loginRequired").value(false)).andExpect(jsonPath("$.profile.nickname").value("新昵称")).andExpect(jsonPath("$.profile.password").doesNotExist());
  assertEquals("测试乙",service.get("activity-two").nickname());
  mvc.perform(get("/api/v1/account/profile").with(user("activity-two"))).andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value("测试乙")).andExpect(jsonPath("$.password").doesNotExist());
 }
 @Test void renamingPreservesReadReceiptsHistoryAndRevokesAllSessions()throws Exception{
  db.update("INSERT INTO activity_events(actor,module,target_id,action,title,route) VALUES ('activity-one','cover','cover','updated','封面','/')");
  long id=db.queryForObject("SELECT max(id) FROM activity_events",Long.class);
  db.update("INSERT INTO activity_reads(account,event_id) VALUES ('activity-one',?)",id);
  db.update("INSERT INTO spring_session(primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time,principal_name) VALUES ('profile-test-session','profile-session-id',0,0,43200,9999999999999,'activity-one')");
  mvc.perform(patch("/api/v1/account/profile").with(user("activity-one")).with(csrf()).contentType("application/json").content("{\"username\":\"renamed_one\",\"nickname\":\"新昵称\",\"oldPassword\":\"original-test-only\"}"))
   .andExpect(status().isOk()).andExpect(jsonPath("$.loginRequired").value(true)).andExpect(jsonPath("$.profile.username").value("renamed_one"));
  assertEquals("renamed_one",db.queryForObject("SELECT account FROM activity_reads WHERE event_id=?",String.class,id));
  assertEquals("renamed_one",db.queryForObject("SELECT actor FROM activity_events WHERE id=?",String.class,id));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM spring_session WHERE principal_name='activity-one'",Integer.class));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM accounts WHERE username='activity-two'",Integer.class));
 }
 @Test void passwordUpdateHashesThePasswordAndRequiresLogin()throws Exception{
  mvc.perform(patch("/api/v1/account/profile").with(user("activity-one")).with(csrf()).contentType("application/json").content("{\"oldPassword\":\"original-test-only\",\"newPassword\":\"replacement-test-only\"}"))
   .andExpect(status().isOk()).andExpect(jsonPath("$.loginRequired").value(true));
  String hash=db.queryForObject("SELECT password FROM accounts WHERE id=1",String.class);
  assertTrue(encoder.matches("replacement-test-only",hash));assertFalse(encoder.matches("original-test-only",hash));
 }
 @Test void rejectsDuplicateUsernameAndAnonymousRequests()throws Exception{
  // A valid occupied username tests the conflict branch independently of input validation.
  db.update("UPDATE accounts SET username='occupied_name' WHERE id=2");
  mvc.perform(patch("/api/v1/account/profile").with(user("activity-one")).with(csrf()).contentType("application/json").content("{\"username\":\"occupied_name\",\"oldPassword\":\"original-test-only\"}"))
   .andExpect(status().isConflict());
  mvc.perform(get("/api/v1/account/profile")).andExpect(status().isUnauthorized());
  mvc.perform(patch("/api/v1/account/profile").with(user("activity-one")).contentType("application/json").content("{\"nickname\":\"新昵称\"}"))
   .andExpect(status().isForbidden());
 }
 @Test @Transactional(propagation=org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
 void realLoginSessionsAreRevokedAndOnlyNewPasswordWorks()throws Exception{
  var first=login("original-test-only",200);var second=login("original-test-only",200);
  mvc.perform(get("/api/v1/account/profile").cookie(second)).andExpect(status().isOk());
  var csrfResult=mvc.perform(get("/api/v1/auth/csrf").cookie(first)).andExpect(status().isOk()).andReturn();
  String token=new com.fasterxml.jackson.databind.ObjectMapper().readTree(csrfResult.getResponse().getContentAsString()).get("token").asText();
  mvc.perform(patch("/api/v1/account/profile").cookie(first).header("X-CSRF-TOKEN",token).contentType("application/json").content("{\"oldPassword\":\"original-test-only\",\"newPassword\":\"replacement-test-only\"}"))
   .andExpect(status().isOk()).andExpect(jsonPath("$.loginRequired").value(true));
  mvc.perform(get("/api/v1/account/profile").cookie(first)).andExpect(status().isUnauthorized());
  mvc.perform(get("/api/v1/account/profile").cookie(second)).andExpect(status().isUnauthorized());
  login("original-test-only",401);
  var updated=login("replacement-test-only",200);
  mvc.perform(get("/api/v1/account/profile").cookie(updated)).andExpect(status().isOk());
 }
 private jakarta.servlet.http.Cookie login(String password,int expected)throws Exception{
  var csrfResult=mvc.perform(get("/api/v1/auth/csrf")).andExpect(status().isOk()).andReturn();
  String token=new com.fasterxml.jackson.databind.ObjectMapper().readTree(csrfResult.getResponse().getContentAsString()).get("token").asText();
  var result=mvc.perform(post("/api/v1/auth/login").cookie(csrfResult.getResponse().getCookies()).header("X-CSRF-TOKEN",token).contentType("application/json").content(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(java.util.Map.of("username","activity-one","password",password))))
   .andExpect(status().is(expected)).andReturn();
  return result.getResponse().getCookie("SESSION");
 }

}
