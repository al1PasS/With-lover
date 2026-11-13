package cn.shiguang;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;

final class AlbumUploadFilter extends OncePerRequestFilter {
    private static final Pattern ROUTE = Pattern.compile("/api/v1/albums/[^/]+/photos");
    private final Semaphore concurrent = new Semaphore(2);

    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !isPhotoUpload(request);
    }

    static boolean isPhotoUpload(HttpServletRequest request) {
        return request.getMethod().equals("POST") && ROUTE.matcher(request.getRequestURI().substring(request.getContextPath().length())).matches();
    }

    @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || auth instanceof AnonymousAuthenticationToken) {
            reject(res, 401, "请先登录");
            return;
        }
        if (!concurrent.tryAcquire()) {
            res.setHeader("Retry-After","5");
            reject(res, 429, "有照片正在上传，请稍后重试");
            return;
        }
        try { chain.doFilter(req, res); }
        finally { concurrent.release(); }
    }

    private static void reject(HttpServletResponse res,int status,String message) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        res.setHeader("Cache-Control","private, no-store");
        res.getWriter().write("{\"message\":\"" + message + "\"}");
    }
}
