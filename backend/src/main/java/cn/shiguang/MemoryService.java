package cn.shiguang;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.UUID;
@Service
class MemoryService {
 private final MemoryRepository repo;
 private final ActivityService activity;
 private final AccountRepository accounts;
 MemoryService(MemoryRepository repo,ActivityService activity,AccountRepository accounts){this.repo=repo;this.activity=activity;this.accounts=accounts;}
 record Input(@NotBlank @Size(max=120) String title,@NotBlank @Size(max=20000) String body,@NotNull LocalDate date,@NotNull @Size(max=60) String city,@NotBlank @Size(max=40) String tag,@NotNull @Size(max=4_000_000) String image,boolean published,boolean publicVisible,@NotNull @Size(max=500) String publicSummary,long version){}
 record PrivateView(UUID id,String title,String body,LocalDate date,String city,String tag,String image,boolean published,boolean publicVisible,String publicSummary,long version,boolean deleted,Short authorId,Instant publishedAt){}
 // Dedicated public DTO: never include private body, author, version or exact coordinates.
 record PublicView(UUID id,String title,LocalDate date,String city,String tag,String image,String publicSummary,boolean published,boolean publicVisible){}
 static PrivateView privateView(Memory m){return new PrivateView(m.id,m.title,m.body,m.date,m.city,m.tag,m.image,m.published,m.publicVisible,m.publicSummary,m.version,m.deletedAt!=null,m.authorId,m.publishedAt);}
 static PublicView publicView(Memory m){return new PublicView(m.id,m.title,m.date,m.city,m.tag,m.image,m.publicSummary,true,true);}
 @Transactional @PreAuthorize("isAuthenticated()")
 public PrivateView save(UUID id,Input in,String author){
  Memory m=id==null?new Memory():repo.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));
  if(m.deletedAt!=null)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  if(id!=null&&in.version()!=m.version)throw new ResponseStatusException(HttpStatus.CONFLICT,"这段回忆已被更新，请保留输入并重新载入后合并");
  if(in.publicVisible()&&in.publicSummary().isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请填写独立公开摘要");
  java.util.List<String> changes=new java.util.ArrayList<>();
  if(!java.util.Objects.equals(m.title,in.title()))changes.add("标题");
  if(!java.util.Objects.equals(m.body,in.body()))changes.add("文字");
  if(!java.util.Objects.equals(m.image,in.image()))changes.add("封面");
  if(!java.util.Objects.equals(m.date,in.date()))changes.add("日期");
  if(!java.util.Objects.equals(m.tag,in.tag()))changes.add("标签");
  if(m.publicVisible!=in.publicVisible()||!java.util.Objects.equals(m.publicSummary,in.publicSummary()))changes.add("公开设置");
  if(id==null){m.author=author;m.authorId=accounts.findByUsername(author).orElseThrow(()->new ResponseStatusException(HttpStatus.UNAUTHORIZED)).id;}
  boolean firstPublication=in.published()&&!m.published&&m.publishedAt==null;
  if(firstPublication)m.publishedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
  m.title=in.title();m.body=in.body();m.date=in.date();m.city=in.city();m.tag=in.tag();m.image=in.image();m.published=in.published();m.publicVisible=in.publicVisible();m.publicSummary=in.publicSummary();m.updatedAt=Instant.now();repo.saveAndFlush(m);if(id==null||firstPublication||!changes.isEmpty())activity.record("memories",m.id.toString(),id==null?"created":firstPublication?"published":"updated",m.title,id==null?"新增了回忆":firstPublication?"发布了回忆":"更新了"+String.join("、",changes),ActivityService.route("memories",m.id.toString()));return privateView(m);
 }
 @Transactional @PreAuthorize("isAuthenticated()") public void trash(UUID id,boolean restore){Memory m=repo.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));if((m.deletedAt==null)==!restore){m.deletedAt=restore?null:Instant.now();repo.save(m);activity.record("memories",id.toString(),restore?"restored":"deleted",m.title,restore?"恢复了回忆":"删除了回忆",ActivityService.route("memories",id.toString()));}}
}
