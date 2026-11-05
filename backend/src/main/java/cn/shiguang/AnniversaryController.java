package cn.shiguang;
import org.springframework.web.bind.annotation.*;import org.springframework.http.HttpStatus;import org.springframework.web.server.ResponseStatusException;import org.springframework.transaction.annotation.Transactional;import jakarta.validation.Valid;import jakarta.validation.constraints.*;import java.time.LocalDate;import java.util.*;
@org.springframework.transaction.annotation.Transactional
@RestController @RequestMapping("/api/v1")
class AnniversaryController{
 private final AnniversaryRepository repo;private final PrivacyService privacy;private final ActivityService activity;AnniversaryController(AnniversaryRepository repo,PrivacyService privacy,ActivityService activity){this.repo=repo;this.privacy=privacy;this.activity=activity;}
 record Lunar(@Min(1) @Max(12) Integer month,@Min(1) @Max(30) Integer day){}
 record Input(@NotBlank @Size(max=100) String title,@NotNull LocalDate date,boolean annual,@Valid Lunar lunar){}
 record View(UUID id,String title,LocalDate date,boolean annual,Lunar lunar,int sortOrder){}
 record Reorder(@NotEmpty List<UUID> ids){}
 static View view(Anniversary a){return new View(a.id,a.title,a.date,a.annual,a.lunarMonth==null?null:new Lunar(a.lunarMonth.intValue(),a.lunarDay.intValue()),a.position);}
 @GetMapping("/anniversaries") List<View> all(){return repo.findAllByOrderByPositionAsc().stream().map(AnniversaryController::view).toList();}
 @GetMapping("/public/anniversaries") List<View> publicAll(){privacy.requirePublic("anniversaries");return repo.findAllByOrderByPositionAsc().stream().map(AnniversaryController::view).toList();}
 @PostMapping("/anniversaries") View create(@Valid @RequestBody Input in){Anniversary a=new Anniversary();copy(in,a);a.position=repo.findTopByOrderByPositionDesc().map(value->value.position+1).orElse(0);repo.save(a);activity.record("anniversaries",a.id.toString(),"created",a.title,"新增了纪念日",ActivityService.route("anniversaries",a.id.toString()));return view(a);}
 @PatchMapping("/anniversaries/{id}") View update(@PathVariable UUID id,@Valid @RequestBody Input in){Anniversary a=repo.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"纪念日不存在"));copy(in,a);repo.save(a);activity.record("anniversaries",a.id.toString(),"updated",a.title,"修改了纪念日",ActivityService.route("anniversaries",a.id.toString()));return view(a);}
 @DeleteMapping("/anniversaries/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) void delete(@PathVariable UUID id){var item=repo.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));repo.deleteById(id);activity.record("anniversaries",id.toString(),"deleted",item.title,"删除了纪念日",ActivityService.route("anniversaries",id.toString()));}
 @PatchMapping("/anniversaries/reorder") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional void reorder(@Valid @RequestBody Reorder in){List<Anniversary> values=repo.findAllByOrderByPositionAsc();if(values.size()!=in.ids().size()||!new HashSet<>(in.ids()).equals(values.stream().map(item->item.id).collect(java.util.stream.Collectors.toSet())))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"排序内容已变化，请重新加载");for(int i=0;i<in.ids().size();i++){Anniversary a=repo.findById(in.ids().get(i)).orElseThrow();a.position=i;} if(!values.stream().map(a->a.id).toList().equals(in.ids()))activity.record("anniversaries","__order__","updated","纪念日顺序","调整了纪念日顺序","/anniversaries"); }
 private static void copy(Input in,Anniversary a){a.title=in.title();a.date=in.date();a.annual=in.annual()||in.lunar()!=null;a.lunarMonth=in.lunar()==null?null:in.lunar().month().shortValue();a.lunarDay=in.lunar()==null?null:in.lunar().day().shortValue();}
}
