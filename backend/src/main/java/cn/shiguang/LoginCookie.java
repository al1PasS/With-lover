package cn.shiguang;

import org.springframework.session.web.http.DefaultCookieSerializer;

final class LoginCookie extends DefaultCookieSerializer {
    static final int LIFETIME = 400 * 24 * 60 * 60;
    static final String PERSIST = LoginCookie.class.getName() + ".persist";
    static final String RENEWED = LoginCookie.class.getName() + ".renewed";

    LoginCookie(boolean secure) {
        setUseSecureCookie(secure);
        setUseHttpOnlyCookie(true);
        setSameSite("Lax");
        setCookiePath("/");
    }

    @Override public void writeCookieValue(CookieValue cookie) {
        if (cookie.getCookieMaxAge() < 0 && Boolean.TRUE.equals(cookie.getRequest().getAttribute(PERSIST)))
            cookie.setCookieMaxAge(LIFETIME);
        super.writeCookieValue(cookie);
    }
}
