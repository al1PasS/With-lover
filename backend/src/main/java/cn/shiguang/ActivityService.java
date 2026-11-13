package cn.shiguang;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@Service
class ActivityService {
 private final JdbcTemplate db;
 private final ObjectMapper mapper;
 private final org.springframework.context.ApplicationEventPublisher events;
 ActivityService(JdbcTemplate db,ObjectMapper mapper,org.springframework.context.ApplicationEventPublisher events){this.db=db;this.mapper=mapper;this.events=events;}
 record Recorded(long id){}
 record Item(long id,String actor,boolean mine,String module,String targetId,String action,String title,String summary,String route,String createdAt,boolean read,boolean deleted){}
 record Feed(List<Item> items,long unread,long latestId,Long nextCursor){}
 private String actor(){return SecurityContextHolder.getContext().getAuthentication().getName();}
 void record(String module,String target,String action,String title,String summary,String route){
  Long id=db.queryForObject("INSERT INTO activity_events(actor,module,target_id,action,title,summary,route) VALUES (?,?,?,?,?,?,?) RETURNING id",Long.class,actor(),module,target,action,clip(title,255),clip(summary,500),route);
  events.publishEvent(new Recorded(id));
 }
 private static String clip(String s,int n){return s==null?"":s.substring(0,Math.min(s.length(),n));}
 private static String encoded(String value){return java.net.URLEncoder.encode(value,java.nio.charset.StandardCharsets.UTF_8);}
 static String route(String module,String id){return switch(module){
  case "memories" -> "/timeline?activity="+encoded(id);
  case "albums" -> "/albums/"+encoded(id);
  case "messages" -> "/records?activity="+encoded(id);
  case "wishes" -> "/wishes?activity="+encoded(id);
  case "anniversaries" -> "/anniversaries?activity="+encoded(id);
  case "places" -> "/places?activity="+encoded(id);
  case "garden" -> "/play";
  case "music" -> "/admin?activity="+encoded(id);
  default -> "/";
 };}
 long unread(String account){return db.queryForObject("SELECT count(*) FROM activity_events e WHERE actor<>? AND NOT EXISTS (SELECT 1 FROM activity_reads r WHERE r.account=? AND r.event_id=e.id)",Long.class,account,account);}
 @Transactional(readOnly=true)
 public Feed feed(String account,boolean all,Long before){
  long latest=Optional.ofNullable(db.queryForObject("SELECT COALESCE(MAX(id),0) FROM activity_events",Long.class)).orElse(0L);
  long unread=unread(account);
  var items=db.query("""
   SELECT e.*,COALESCE(a.nickname,e.actor) nickname,
    EXISTS(SELECT 1 FROM activity_reads r WHERE r.account=? AND r.event_id=e.id) is_read,
    COALESCE((SELECT x.action='deleted' FROM activity_events x WHERE x.module=e.module AND x.target_id=e.target_id AND x.action NOT IN ('liked','commented') ORDER BY x.id DESC LIMIT 1),false) deleted
   FROM activity_events e LEFT JOIN accounts a ON a.username=e.actor
   WHERE (? OR e.actor<>?) AND e.id<? ORDER BY e.id DESC LIMIT 31
   """,(rs,n)->new Item(rs.getLong("id"),rs.getString("nickname"),account.equals(rs.getString("actor")),rs.getString("module"),rs.getString("target_id"),rs.getString("action"),rs.getString("title"),rs.getString("summary"),rs.getString("route"),rs.getTimestamp("created_at").toInstant().toString(),rs.getBoolean("is_read")||account.equals(rs.getString("actor")),rs.getBoolean("deleted")),account,all,account,before==null?Long.MAX_VALUE:before);
  boolean more=items.size()>30;var visible=items.subList(0,Math.min(30,items.size()));
  return new Feed(visible,unread,latest,more?visible.get(visible.size()-1).id():null);
 }
 @Transactional public void read(String account,long id){
  if(db.queryForObject("SELECT count(*) FROM activity_events WHERE id=?",Integer.class,id)==0)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  db.update("INSERT INTO activity_reads(account,event_id) VALUES (?,?) ON CONFLICT DO NOTHING",account,id);
 }
 @Transactional public void readAll(String account,long through){db.update("INSERT INTO activity_reads(account,event_id) SELECT ?,id FROM activity_events WHERE id<=? AND actor<>? ON CONFLICT DO NOTHING",account,through,account);}

 // Diff shared JSON collections at the server, never accept a client-supplied actor or summary.
 void settings(String key,String oldValue,String newValue){
  if(Objects.equals(oldValue,newValue))return;
  if(key.equals("cover")){record(key,key,"updated","首页封面","更换了首页封面","/");return;}
  try{
   JsonNode old=oldValue==null||oldValue.isBlank()?mapper.createArrayNode():mapper.readTree(oldValue), next=mapper.readTree(newValue);
   if(key.equals("garden")){
    if(next.path("level").asInt(1)>old.path("level").asInt(1))record(key,key,"milestone",next.path("name").asText("小芽"),"成长到了第 "+next.path("level").asInt()+" 级","/play");return;
   }
   if(!Set.of("albums","messages","wishes").contains(key)||!next.isArray())return;
   Map<String,JsonNode> previous=index(old), current=index(next);
   for(var entry:current.entrySet()){
    String id=entry.getKey();JsonNode item=entry.getValue(), before=previous.get(id);
    if(item.equals(before))continue;
    String title=item.path(key.equals("wishes")?"text":"title").asText("未命名内容");
    String destination=route(key,id);
    String action=before==null?"created":"updated",summary=before==null?"新增了"+label(key):"修改了"+label(key);
    if(key.equals("wishes")&&before!=null&&item.path("done").asBoolean()!=before.path("done").asBoolean()){
     action=item.path("done").asBoolean()?"completed":"reopened";summary=action.equals("completed")?"完成了愿望":"重新开启了愿望";
    }
    if(key.equals("albums")&&before!=null){
     var oldPhotos=index(before.path("photos"));var photos=index(item.path("photos"));
     long added=photos.keySet().stream().filter(x->!oldPhotos.containsKey(x)).count(),removed=oldPhotos.keySet().stream().filter(x->!photos.containsKey(x)).count();
     if(added>0){summary="添加了 "+added+" 张照片";String photo=photos.keySet().stream().filter(x->!oldPhotos.containsKey(x)).findFirst().orElse("");destination+="?activity="+encoded(photo);}else if(removed>0)summary="移除了 "+removed+" 张照片";
    }
    record(key,id,action,title,summary,destination);
   }
   for(var entry:previous.entrySet())if(!current.containsKey(entry.getKey()))record(key,entry.getKey(),"deleted",entry.getValue().path(key.equals("wishes")?"text":"title").asText("未命名内容"),"删除了"+label(key),route(key,entry.getKey()));
  }catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"内容格式无效");}
 }
 private static Map<String,JsonNode> index(JsonNode node){Map<String,JsonNode> result=new LinkedHashMap<>();if(node.isArray())for(JsonNode item:node){String id=item.path("id").asText();if(!id.isBlank())result.put(id,item);}return result;}
 private static String label(String key){return switch(key){case "albums"->"相册";case "wishes"->"愿望";default->"记录";};}
}
