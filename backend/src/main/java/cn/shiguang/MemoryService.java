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
 MemoryService(MemoryRepository repo){this.repo=repo;}
 record Input(@NotBlank @Size(max=120) String title,@NotBlank @Size(max=20000) String body,@NotNull LocalDate date,@NotNull @Size(max=60) String city,@NotBlank @Size(max=40) String tag,@NotNull @Size(max=4_000_000) String image,boolean published,boolean publicVisible,@NotNull @Size(max=500) String publicSummary,long version){}
 record PrivateView(UUID id,String title,String body,LocalDate date,String city,String tag,String image,boolean published,boolean publicVisible,String publicSummary,long version,boolean deleted){}
 // Dedicated public DTO: never include private body, author, version or exact coordinates.
 record PublicView(UUID id,String title,LocalDate date,String city,String tag,String image,String publicSummary,boolean published,boolean publicVisible){}
 static PrivateView privateView(Memory m){return new PrivateView(m.id,m.title,m.body,m.date,m.city,m.tag,m.image,m.published,m.publicVisible,m.publicSummary,m.version,m.deletedAt!=null);}
 static PublicView publicView(Memory m){return new PublicView(m.id,m.title,m.date,m.city,m.tag,m.image,m.publicSummary,true,true);}
 @Transactional @PreAuthorize("isAuthenticated()")
 public PrivateView save(UUID id,Input in,String author){
  Memory m=id==null?new Memory():repo.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));
  if(m.deletedAt!=null)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  if(id!=null&&in.version()!=m.version)throw new ResponseStatusException(HttpStatus.CONFLICT,"这段回忆已被更新，请保留输入并重新载入后合并");
  if(in.publicVisible()&&in.publicSummary().isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请填写独立公开摘要");
  m.title=in.title();m.body=in.body();m.date=in.date();m.city=in.city();m.tag=in.tag();m.image=in.image();m.published=in.published();m.publicVisible=in.publicVisible();m.publicSummary=in.publicSummary();m.author=author;m.updatedAt=Instant.now();return privateView(repo.saveAndFlush(m));
 }
 @Transactional @PreAuthorize("isAuthenticated()") public void trash(UUID id,boolean restore){Memory m=repo.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));m.deletedAt=restore?null:Instant.now();repo.save(m);}
}
