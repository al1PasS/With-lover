package cn.shiguang;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

class MusicUploadFilterTest {
    @AfterEach void clear() { SecurityContextHolder.clearContext(); }
    private void login() {
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated("one",null,List.of()));
    }
    private MockHttpServletRequest upload() { return new MockHttpServletRequest("POST","/api/v1/music/tracks"); }
    @Test void anonymousUploadIsRejectedWithoutParsingBodyOrCallingChain() throws Exception {
        var response = new MockHttpServletResponse();
        new MusicUploadFilter(1).doFilter(upload(),response,(req,res)->fail("Must not parse anonymous body"));
        assertEquals(401,response.getStatus());
    }
    @Test void limitsConcurrentMultipartBeforeParsingAndReleasesPermit() throws Exception {
        var filter = new MusicUploadFilter(1);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        var pool = Executors.newSingleThreadExecutor();
        try {
            var first = pool.submit(() -> {
                login();
                try { filter.doFilter(upload(),new MockHttpServletResponse(),(req,res)->{
                    entered.countDown();
                    try { assertTrue(release.await(10,TimeUnit.SECONDS)); }
                    catch(InterruptedException ex) { throw new RuntimeException(ex); }
                }); } catch(Exception ex) { throw new RuntimeException(ex); }
                finally { SecurityContextHolder.clearContext(); }
            });
            assertTrue(entered.await(10,TimeUnit.SECONDS)); login();
            var response = new MockHttpServletResponse();
            filter.doFilter(upload(),response,(req,res)->fail("Busy upload must not parse body"));
            assertEquals(429,response.getStatus()); assertTrue(response.getContentAsString().contains("UPLOAD_BUSY"));
            release.countDown(); first.get(10,TimeUnit.SECONDS);
            var next = new MockHttpServletResponse(); filter.doFilter(upload(),next,(req,res)->{});
            assertEquals(200,next.getStatus());
        } finally { release.countDown(); pool.shutdownNow(); }
    }
}
