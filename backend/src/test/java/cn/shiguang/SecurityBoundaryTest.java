package cn.shiguang;
import org.junit.jupiter.api.Test;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;import org.springframework.context.annotation.Import;import org.springframework.test.context.bean.override.mockito.MockitoBean;import org.springframework.test.web.servlet.MockMvc;import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;import static org.mockito.Mockito.*;import org.springframework.data.domain.PageImpl;import org.springframework.http.HttpStatus;import org.springframework.web.server.ResponseStatusException;import java.util.List;
@WebMvcTest({MemoryController.class,AuthController.class,PlaceController.class}) @Import(SecurityConfig.class)
class SecurityBoundaryTest {
 @Autowired MockMvc mvc;
 @MockitoBean MemoryRepository memories;
 @MockitoBean MemoryService service;
 @MockitoBean AccountRepository accounts;
 @MockitoBean PlaceRepository places;
 @MockitoBean PrivacyService privacy;
 @Test void anonymousCannotReadPrivateRecords()throws Exception{mvc.perform(get("/api/v1/memories")).andExpect(status().isUnauthorized());}
 @Test void publicListOmitsPrivateBody()throws Exception{Memory m=new Memory();m.title="标题";m.body="禁止公开的正文";m.publicSummary="独立摘要";when(memories.findByPublishedTrueAndPublicVisibleTrueAndDeletedAtIsNullOrderByDateDesc(any())).thenReturn(new PageImpl<>(List.of(m)));mvc.perform(get("/api/v1/public/memories")).andExpect(status().isOk()).andExpect(jsonPath("$[0].publicSummary").value("独立摘要")).andExpect(jsonPath("$[0].body").doesNotExist()).andExpect(header().string("Cache-Control","no-cache, no-store, max-age=0, must-revalidate"));}
 @Test void disabledPublicModuleIsRejectedByBackend()throws Exception{doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN,"这一部分暂时只留给登录后的我们")).when(privacy).requirePublic("timeline");mvc.perform(get("/api/v1/public/memories")).andExpect(status().isForbidden());}
 @Test void authenticatedWritesStillRequireCsrf()throws Exception{mvc.perform(post("/api/v1/memories").with(user("one")).contentType("application/json").content("{}")).andExpect(status().isForbidden());}
 @Test void loginRequiresCsrf()throws Exception{mvc.perform(post("/api/v1/auth/login").contentType("application/json").content("{\"username\":\"one\",\"password\":\"secret\"}")).andExpect(status().isForbidden());}
 @Test void anonymousSessionEndpointReturnsJson()throws Exception{mvc.perform(get("/api/v1/auth/me")).andExpect(status().isOk()).andExpect(content().json("{\"name\":null,\"role\":null}"));}
 @Test void csrfEndpointAvailableWithoutLogin()throws Exception{mvc.perform(get("/api/v1/auth/csrf")).andExpect(status().isOk()).andExpect(jsonPath("$.token").isString());}
 @Test void memberCannotManageCuratedPlaces()throws Exception{mvc.perform(post("/api/v1/admin/places").with(user("member").roles("MEMBER")).with(csrf()).contentType("application/json").content("{}" )).andExpect(status().isForbidden());}
}
