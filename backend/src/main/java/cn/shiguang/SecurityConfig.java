package cn.shiguang;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.*;
import org.springframework.security.web.csrf.*;
import org.springframework.http.HttpMethod;
@Configuration @EnableMethodSecurity
class SecurityConfig {
 @Bean PasswordEncoder passwordEncoder(){return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();}
 @Bean UserDetailsService users(AccountRepository accounts){return name->accounts.findByUsername(name).map(a->User.withUsername(a.username).password(a.password).roles(a.role).build()).orElseThrow(()->new UsernameNotFoundException("账户或密码不正确"));}
 @Bean SecurityContextRepository contextRepository(){return new HttpSessionSecurityContextRepository();}
 @Bean SecurityFilterChain chain(HttpSecurity http,SecurityContextRepository contexts)throws Exception{
  http.authorizeHttpRequests(a->a.requestMatchers(HttpMethod.GET,"/actuator/health","/api/v1/public/**","/api/v1/auth/csrf","/api/v1/auth/me").permitAll().requestMatchers(HttpMethod.POST,"/api/v1/auth/login").permitAll().requestMatchers("/api/v1/admin/**").hasRole("ADMIN").anyRequest().authenticated());
  http.securityContext(c->c.securityContextRepository(contexts));
  http.csrf(c->c.csrfTokenRepository(new HttpSessionCsrfTokenRepository()));
  http.requestCache(c->c.disable()).formLogin(c->c.disable()).httpBasic(c->c.disable());
  http.logout(l->l.logoutUrl("/api/v1/auth/logout").logoutSuccessHandler((req,res,auth)->res.setStatus(204)).invalidateHttpSession(true).deleteCookies("SESSION"));
  http.exceptionHandling(e->e.authenticationEntryPoint((req,res,ex)->{res.setStatus(401);res.setContentType("application/json;charset=UTF-8");res.getWriter().write("{\"message\":\"请先登录\"}");}).accessDeniedHandler((req,res,ex)->{res.setStatus(403);res.setContentType("application/json;charset=UTF-8");res.getWriter().write("{\"message\":\"无权操作或安全令牌已过期，请刷新页面\"}");}));
  http.headers(h->h.cacheControl(c->{}));
  return http.build();
 }
}
