package cn.shiguang;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.security.Principal;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PrivacyServiceTest {
 @Test void defaultOnlyOpensHomeAndSelectedTimeline(){
  var repo=mock(SiteSettingRepository.class);when(repo.findById("privacy")).thenReturn(Optional.empty());
  var service=new PrivacyService(repo,new ObjectMapper());var policy=service.get();
  assertTrue(policy.home());assertTrue(policy.timeline());assertFalse(policy.albums());assertFalse(policy.places());
 }

 @Test void privateModeClosesEveryModuleBeforeSaving(){
  var repo=mock(SiteSettingRepository.class);when(repo.findById("privacy")).thenReturn(Optional.empty());
  var service=new PrivacyService(repo,new ObjectMapper());Principal principal=()->"admin";
  var saved=service.save(new PrivacyService.Policy("PRIVATE",true,true,true,true,true),principal);
  assertFalse(saved.home());assertFalse(saved.timeline());assertFalse(saved.anniversaries());assertFalse(saved.albums());assertFalse(saved.places());
  verify(repo).save(any(SiteSetting.class));
 }

 @Test void selectedMusicIsIndependentOfEveryPageModuleSwitch(){
  var repo=mock(SiteSettingRepository.class);
  when(repo.findById("privacy")).thenReturn(Optional.of(new SiteSetting("privacy",
    "{\"mode\":\"SELECTED\",\"home\":false,\"timeline\":false,\"anniversaries\":false,\"albums\":false,\"places\":false}","admin")));
  var service=new PrivacyService(repo,new ObjectMapper());
  assertDoesNotThrow(service::requirePublicMusic);
  for(String module:new String[]{"home","timeline","anniversaries","albums","places"})
   assertThrows(ResponseStatusException.class,()->service.requirePublic(module));
 }

 @Test void defaultSelectedPolicyAllowsCurrentMusic(){
  var repo=mock(SiteSettingRepository.class);when(repo.findById("privacy")).thenReturn(Optional.empty());
  assertDoesNotThrow(new PrivacyService(repo,new ObjectMapper())::requirePublicMusic);
 }

 @Test void privateMalformedAndUnknownStoredPoliciesVetoPublicMusic(){
  var repo=mock(SiteSettingRepository.class);var service=new PrivacyService(repo,new ObjectMapper());
  for(String value:new String[]{"{\"mode\":\"PRIVATE\",\"home\":true,\"timeline\":true,\"anniversaries\":true,\"albums\":true,\"places\":true}",
    "not-json","null","{}","{\"mode\":\"PUBLIC\"}"}){
   when(repo.findById("privacy")).thenReturn(Optional.of(new SiteSetting("privacy",value,"admin")));
   assertEquals(403,assertThrows(ResponseStatusException.class,service::requirePublicMusic).getStatusCode().value());
  }
 }

 @Test void malformedStoredPolicyFailsClosed(){
  var repo=mock(SiteSettingRepository.class);var item=new SiteSetting("privacy","not-json","admin");
  when(repo.findById("privacy")).thenReturn(Optional.of(item));var service=new PrivacyService(repo,new ObjectMapper());
  assertThrows(ResponseStatusException.class,()->service.requirePublic("home"));
 }
}
