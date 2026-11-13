package cn.shiguang;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
@RestController @RequestMapping("/api/v1/auth")
class AuthController {
 private final UserDetailsService users;private final AccountRepository accounts;private final PasswordEncoder passwords;private final SecurityContextRepository contexts;private final LoginCookie cookies;
 private final Map<String,Attempts> attempts=new ConcurrentHashMap<>();private final String dummyHash;
 record Attempts(int count,long since){}
 AuthController(UserDetailsService users,AccountRepository accounts,PasswordEncoder passwords,SecurityContextRepository contexts,LoginCookie cookies){this.users=users;this.accounts=accounts;this.passwords=passwords;this.contexts=contexts;this.cookies=cookies;dummyHash=passwords.encode(UUID.randomUUID().toString());}
 record Login(@NotBlank @Size(max=80) String username,@NotBlank @Size(max=200) String password){}
 @GetMapping("/csrf") Map<String,String> csrf(CsrfToken token){return Map.of("token",token.getToken(),"headerName",token.getHeaderName());}
 record Me(String name,String role){}
 @GetMapping("/me") Me me(Authentication auth,HttpServletRequest request,HttpServletResponse response){
  if(auth==null)return new Me(null,null);
  var account=accounts.findByUsername(auth.getName());
  if(account.isEmpty())return new Me(null,null);
  var session=request.getSession(false);
  if(session!=null){
   long now=System.currentTimeMillis();
   if(!(session.getAttribute(LoginCookie.RENEWED) instanceof Long last)||now-last>=86_400_000L){
    remember(session,request,now);
    cookies.writeCookieValue(new org.springframework.session.web.http.CookieSerializer.CookieValue(request,response,session.getId()));
   }
  }
  return account.map(a->new Me(a.nickname,a.role)).orElseThrow();
 }
 private void remember(HttpSession session,HttpServletRequest request,long now){
  session.setMaxInactiveInterval(LoginCookie.LIFETIME);
  session.setAttribute(LoginCookie.RENEWED,now);
  request.setAttribute(LoginCookie.PERSIST,true);
 }
 record Member(short id,String name){}
 @GetMapping("/members") List<Member> members(){return accounts.findAll().stream().map(a->new Member(a.id,a.nickname)).toList();}
 @PostMapping("/login") synchronized Map<String,String> login(@Valid @RequestBody Login body,HttpServletRequest request,HttpServletResponse response){
  long now=System.currentTimeMillis();attempts.entrySet().removeIf(e->now-e.getValue().since>900000);
  String key=request.getRemoteAddr();String accountKey="account:"+body.username();
  for(String k:List.of(key,accountKey)){Attempts a=attempts.getOrDefault(k,new Attempts(0,now));if(a.count>=10)throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"尝试次数较多，请 15 分钟后重试");attempts.put(k,new Attempts(a.count+1,a.since));}
  UserDetails user;try{user=users.loadUserByUsername(body.username());}catch(UsernameNotFoundException e){passwords.matches(body.password(),dummyHash);throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"账户或密码不正确");}
  if(!passwords.matches(body.password(),user.getPassword()))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"账户或密码不正确");
  if(request.getSession(false)!=null)request.getSession(false).invalidate();remember(request.getSession(true),request,now);
  var auth=UsernamePasswordAuthenticationToken.authenticated(user.getUsername(),null,user.getAuthorities());
  var context=SecurityContextHolder.createEmptyContext();context.setAuthentication(auth);SecurityContextHolder.setContext(context);contexts.saveContext(context,request,response);attempts.remove(accountKey);
  return Map.of("name",user.getUsername());
 }
}
