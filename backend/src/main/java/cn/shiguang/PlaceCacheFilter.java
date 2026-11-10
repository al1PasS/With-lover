package cn.shiguang;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** Runs before security so authentication/CSRF/validation errors have the same no-store baseline. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
class PlaceCacheFilter extends OncePerRequestFilter {
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return !(path.equals("/api/v1/places") || path.equals("/api/v1/public/places")
                || path.startsWith("/api/v1/admin/places") || path.startsWith("/api/v1/media/places/")
                || path.startsWith("/api/v1/public/media/places/"));
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
        // HEAD is deliberately not part of this media API; do not trigger expensive GET derivation for it.
        if ("HEAD".equals(request.getMethod()) && request.getRequestURI().contains("/media/places/")) {
            response.setHeader(HttpHeaders.ALLOW, "GET");
            response.setStatus(405);
            return;
        }
        chain.doFilter(request, new jakarta.servlet.http.HttpServletResponseWrapper(response) {
            @Override public void addHeader(String name, String value) {
                // ResponseEntity adds headers; replace the no-store baseline rather than emitting two policies.
                if (HttpHeaders.CACHE_CONTROL.equalsIgnoreCase(name)) setHeader(name, value);
                else super.addHeader(name, value);
            }
        });
    }
}
