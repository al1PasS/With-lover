package cn.shiguang;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.util.Optional;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(SiteSettingController.class)
@Import(SecurityConfig.class)
class CoverImageTest {
 @Autowired MockMvc mvc;
 @MockitoBean SiteSettingRepository settings;
 @MockitoBean PrivacyService privacy;
 @MockitoBean AccountRepository accounts;

 @Test void imageUsesBinaryResponseAndConditionalCache() throws Exception {
  when(settings.findById("cover")).thenReturn(Optional.of(new SiteSetting("cover","\"data:image/webp;base64,AQID\"","admin")));
  var result=mvc.perform(get("/api/v1/public/media/cover"))
   .andExpect(status().isOk()).andExpect(content().contentType("image/webp"))
   .andExpect(content().bytes(new byte[]{1,2,3}))
   .andExpect(header().string("Cache-Control","private, no-cache")).andReturn();
  String etag=result.getResponse().getHeader("ETag");
  mvc.perform(get("/api/v1/public/media/cover").header("If-None-Match",etag))
   .andExpect(status().isNotModified()).andExpect(content().string(""));
  doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(privacy).requirePublic("home");
  mvc.perform(get("/api/v1/public/media/cover").header("If-None-Match",etag)).andExpect(status().isForbidden());
 }
 @Test void changedCoverInvalidatesCache() throws Exception {
  when(settings.findById("cover")).thenReturn(Optional.of(new SiteSetting("cover","\"data:image/webp;base64,AQID\"","admin")));
  String etag=mvc.perform(get("/api/v1/public/media/cover")).andReturn().getResponse().getHeader("ETag");
  when(settings.findById("cover")).thenReturn(Optional.of(new SiteSetting("cover","\"data:image/webp;base64,BAUG\"","admin")));
  mvc.perform(get("/api/v1/public/media/cover").header("If-None-Match",etag))
   .andExpect(status().isOk()).andExpect(content().bytes(new byte[]{4,5,6}));
 }
 @Test void privateImageRequiresLogin() throws Exception {
  mvc.perform(get("/api/v1/media/cover")).andExpect(status().isUnauthorized());
 }
 @Test void unsetCoverUsesBundledImage() throws Exception {
  when(settings.findById("cover")).thenReturn(Optional.empty());
  mvc.perform(get("/api/v1/public/media/cover")).andExpect(status().isFound())
   .andExpect(header().string("Location","/images/cover.webp"));
 }
}
