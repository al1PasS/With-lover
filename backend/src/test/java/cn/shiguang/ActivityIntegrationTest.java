package cn.shiguang;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
@SpringBootTest
@EnabledIfEnvironmentVariable(named="ACTIVITY_DB_TEST",matches="true")
class ActivityIntegrationTest {
 @Autowired org.springframework.test.web.servlet.MockMvc mvc;
 @Autowired ActivityService activity;
 @Autowired JdbcTemplate db;
 @Autowired TransactionTemplate transactions;
 @BeforeEach void accounts(){
  db.update("INSERT INTO accounts(id,username,password,nickname,role) VALUES (1,'activity-one','unused','杰杰','ADMIN'),(2,'activity-two','unused','雯晴','MEMBER') ON CONFLICT DO NOTHING");
 }
 @AfterEach void clearContext(){SecurityContextHolder.clearContext();}
 void as(String name){SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(name,null,List.of()));}
 @Test @Transactional void unreadIsPerAccountAndMarkAllDoesNotConsumeLaterWrites(){
  as("activity-one");activity.record("memories","test","created","旧日期的新回忆","新增了回忆","/timeline?activity=test");
  var mine=activity.feed("activity-one",false,null);assertEquals(0,mine.unread());assertTrue(mine.items().isEmpty());
  var other=activity.feed("activity-two",false,null);assertEquals(1,other.unread());assertEquals(db.queryForObject("SELECT nickname FROM accounts WHERE id=1",String.class),other.items().getFirst().actor());
  assertEquals(1,activity.feed("activity-two",false,null).unread()); // opening is not reading
  activity.record("cover","cover","updated","封面","更换封面","/");
  activity.readAll("activity-two",other.latestId());
  var remaining=activity.feed("activity-two",false,null);assertEquals(1,remaining.unread());
  activity.read("activity-two",remaining.items().getFirst().id());activity.read("activity-two",remaining.items().getFirst().id());
  assertEquals(0,activity.feed("activity-two",false,null).unread());
  assertTrue(activity.feed("activity-one",true,null).items().stream().allMatch(ActivityService.Item::read));
 }
 @Test @Transactional void collectionsProduceBatchSummaryAndDeletionState(){
  as("activity-one");
  String first="[{\"id\":\"album\",\"title\":\"海边\",\"photos\":[]}]";
  String photos="[{\"id\":\"album\",\"title\":\"海边\",\"photos\":[{\"id\":\"a\"},{\"id\":\"b\"}]}]";
  activity.settings("albums","",first);activity.settings("albums",first,photos);activity.settings("albums",photos,photos);
  var feed=activity.feed("activity-two",false,null);assertEquals(2,feed.items().size());assertEquals("添加了 2 张照片",feed.items().getFirst().summary());assertEquals("/albums/album?activity=a",feed.items().getFirst().route());
  activity.settings("albums",photos,"[]");assertTrue(activity.feed("activity-two",false,null).items().stream().allMatch(ActivityService.Item::deleted));
  activity.settings("albums","[]",first);assertFalse(activity.feed("activity-two",false,null).items().stream().anyMatch(ActivityService.Item::deleted));
  activity.settings("garden","{\"level\":1}","{\"level\":1,\"water\":90}");
  assertEquals(4,activity.feed("activity-two",false,null).items().size());
  activity.settings("wishes","[{\"id\":\"w\",\"text\":\"日出\",\"done\":false}]","[{\"id\":\"w\",\"text\":\"日出\",\"done\":true}]");
  assertEquals("completed",activity.feed("activity-two",false,null).items().getFirst().action());
 }
 @Test @Transactional void cursorPagesHaveNoDuplicates(){
  as("activity-one");for(int i=0;i<35;i++)activity.record("cover","cover","updated","封面","更换封面","/");
  var first=activity.feed("activity-two",false,null);assertEquals(30,first.items().size());assertNotNull(first.nextCursor());
  var second=activity.feed("activity-two",false,first.nextCursor());assertEquals(5,second.items().size());assertNull(second.nextCursor());
  assertTrue(second.items().stream().allMatch(x->x.id()<first.nextCursor()));
 }
 @Test @Transactional void actualWritesCreateActivitiesAndDetailSupportsOldMemories()throws Exception{
  var one=org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("activity-one");
  var csrf=org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf();
  mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/v1/memories").with(one).with(csrf).contentType("application/json").content("{\"title\":\"旧日期回忆\",\"body\":\"故事\",\"date\":\"2020-01-01\",\"city\":\"\",\"tag\":\"日常\",\"image\":\"\",\"published\":true,\"publicVisible\":false,\"publicSummary\":\"\",\"version\":0}"))
   .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isCreated());
  var created=activity.feed("activity-two",false,null).items().getFirst();assertEquals("created",created.action());
  mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/memories/"+created.targetId()).with(one)).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
  mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/v1/memories/"+created.targetId()).with(one).with(csrf)).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNoContent());
  assertTrue(activity.feed("activity-two",false,null).items().stream().allMatch(ActivityService.Item::deleted));
  mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/v1/trash/"+created.targetId()+"/restore").with(one).with(csrf)).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNoContent());
  assertFalse(activity.feed("activity-two",false,null).items().stream().anyMatch(ActivityService.Item::deleted));
  mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/v1/settings/wishes").with(one).with(csrf).contentType("application/json").content("{\"value\":\"[{\\\"id\\\":\\\"wish-route\\\",\\\"text\\\":\\\"日出\\\",\\\"done\\\":false}]\"}"))
   .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
  assertEquals("wishes",activity.feed("activity-two",false,null).items().getFirst().module());
 }
 @Test void failedTransactionRollsBackItsActivity(){
  as("activity-one");long count=db.queryForObject("SELECT count(*) FROM activity_events",Long.class);
  assertThrows(IllegalStateException.class,()->transactions.execute(status->{activity.record("cover","cover","updated","封面","更换封面","/");throw new IllegalStateException("failed save");}));
  assertEquals(count,db.queryForObject("SELECT count(*) FROM activity_events",Long.class));
 }
}
