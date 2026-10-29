package cn.shiguang;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.security.Principal;
import java.time.Instant;
import java.util.Set;

@Service
class PrivacyService {
 private static final String KEY="privacy";
 private static final Set<String> MODULES=Set.of("home","timeline","anniversaries","albums","places");
 private final SiteSettingRepository repo;
 private final ObjectMapper json;

 PrivacyService(SiteSettingRepository repo,ObjectMapper json){this.repo=repo;this.json=json;}

 record Policy(@NotNull String mode,boolean home,boolean timeline,boolean anniversaries,boolean albums,boolean places){
  static Policy defaults(){return new Policy("SELECTED",true,true,false,false,false);}
  static Policy privateOnly(){return new Policy("PRIVATE",false,false,false,false,false);}
  boolean allows(String module){
   if(!"SELECTED".equals(mode))return false;
   return switch(module){
    case "home"->home;
    case "timeline"->timeline;
    case "anniversaries"->anniversaries;
    case "albums"->albums;
    case "places"->places;
    default->false;
   };
  }
 }

 Policy get(){
  return repo.findById(KEY).map(item->{
   try{return normalize(json.readValue(item.value,Policy.class));}
   catch(Exception ignored){return Policy.privateOnly();}
  }).orElseGet(Policy::defaults);
 }

 Policy save(Policy input,Principal principal){
  Policy policy=normalize(input);
  try{
   String value=json.writeValueAsString(policy);
   SiteSetting item=repo.findById(KEY).orElseGet(()->new SiteSetting(KEY,value,principal.getName()));
   item.value=value;item.updatedAt=Instant.now();item.updatedBy=principal.getName();repo.save(item);
   return policy;
  }catch(JsonProcessingException error){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"访客设置无法保存");}
 }

 void requirePublic(String module){
  if(!MODULES.contains(module)||!get().allows(module))
   throw new ResponseStatusException(HttpStatus.FORBIDDEN,"这一部分暂时只留给登录后的我们");
 }

 private static Policy normalize(Policy input){
  if(input==null)return Policy.privateOnly();
  if(!Set.of("PRIVATE","SELECTED").contains(input.mode()))
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请选择有效的访客模式");
  if("PRIVATE".equals(input.mode()))return Policy.privateOnly();
  return new Policy("SELECTED",input.home(),input.timeline(),input.anniversaries(),input.albums(),input.places());
 }
}
