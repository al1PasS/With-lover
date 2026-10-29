package cn.shiguang;
import jakarta.validation.Valid;import jakarta.validation.constraints.*;import org.springframework.http.*;import org.springframework.web.bind.annotation.*;import org.springframework.web.server.ResponseStatusException;import java.time.LocalDate;import java.util.*;
@RestController @RequestMapping("/api/v1")
class PlaceController {
 private final PlaceRepository repo;private final PrivacyService privacy;
 PlaceController(PlaceRepository repo,PrivacyService privacy){this.repo=repo;this.privacy=privacy;}
 record Input(@NotBlank @Size(max=100) String city,@NotBlank @Size(max=8_000_000) String panoramaImage,LocalDate visitDate,@Size(max=500) String description){}
 record View(UUID id,String city,String panoramaImage,LocalDate visitDate,String description,int sortOrder){}
 record Reorder(@NotEmpty List<UUID> ids){}
 static View view(Place p){return new View(p.id,p.city,p.panoramaImage,p.visitDate,p.description,p.sortOrder);}
 private void apply(Place p,Input in){p.city=in.city();p.name=in.city();p.panoramaImage=in.panoramaImage();p.referenceImage="";p.generationPrompt="";p.visitDate=in.visitDate();p.description=Objects.requireNonNullElse(in.description(),"");}
 @GetMapping("/places") List<View> all(){return repo.findAllByOrderBySortOrderAscCreatedAtDesc().stream().map(PlaceController::view).toList();}
 @GetMapping("/public/places") List<View> publicAll(){privacy.requirePublic("places");return all();}
 @PostMapping("/admin/places") @ResponseStatus(HttpStatus.CREATED) View create(@Valid @RequestBody Input in){Place p=new Place();apply(p,in);p.sortOrder=(int)repo.count();return view(repo.save(p));}
 @PatchMapping("/admin/places/{id}") View update(@PathVariable UUID id,@Valid @RequestBody Input in){Place p=repo.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));apply(p,in);return view(repo.save(p));}
 @DeleteMapping("/admin/places/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) void delete(@PathVariable UUID id){if(!repo.existsById(id))throw new ResponseStatusException(HttpStatus.NOT_FOUND);repo.deleteById(id);}
 @PatchMapping("/admin/places/reorder") List<View> reorder(@Valid @RequestBody Reorder input){
  Map<UUID,Place> items=new HashMap<>();repo.findAllById(input.ids()).forEach(p->items.put(p.id,p));
  if(items.size()!=input.ids().size())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"地点列表已经变化，请刷新后重试");
  for(int i=0;i<input.ids().size();i++){Place p=items.get(input.ids().get(i));p.sortOrder=i;repo.save(p);}
  return repo.findAllByOrderBySortOrderAscCreatedAtDesc().stream().map(PlaceController::view).toList();
 }
}
