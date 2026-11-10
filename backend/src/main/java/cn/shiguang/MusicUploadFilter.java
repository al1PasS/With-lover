package cn.shiguang;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.Semaphore;

/** Runs before CSRF / DispatcherServlet can parse and spool a multipart body. */
class MusicUploadFilter extends OncePerRequestFilter {
    private final Semaphore uploads;
    MusicUploadFilter(int concurrent) {
        if (concurrent < 1 || concurrent > 4) throw new IllegalArgumentException("Invalid music upload concurrency");
        uploads = new Semaphore(concurrent);
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        boolean endpoint = request.getMethod().equals("POST")
                && request.getRequestURI().equals(request.getContextPath() + "/api/v1/music/tracks");
        boolean authenticated = authentication != null && authentication.isAuthenticated()
                && !(authentication instanceof AnonymousAuthenticationToken);
        if (endpoint && !authenticated) {
            response.setStatus(401);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"message\":\"请先登录\"}");
            return;
        }
        boolean upload = endpoint && authenticated;
        if (!upload) { chain.doFilter(request, response); return; }
        if (!uploads.tryAcquire()) {
            response.setStatus(429);
            response.setContentType("application/json;charset=UTF-8");
            response.setHeader("Cache-Control", "private, no-store");
            response.setHeader("Retry-After", "5");
            response.getWriter().write("{\"code\":\"UPLOAD_BUSY\",\"message\":\"已有音乐正在上传，请稍后重试\",\"requestId\":\""+ UUID.randomUUID()+"\"}");
            return;
        }
        try { chain.doFilter(request, response); }
        finally { uploads.release(); }
    }
}
