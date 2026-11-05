package cn.shiguang;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
class ProfileService {
 private final AccountRepository accounts;
 private final PasswordEncoder passwords;
 private final JdbcTemplate db;
 private final ActivityService activity;
 private final Map<Short,Attempts> attempts=new ConcurrentHashMap<>();
 record Attempts(int count,long since){}
 record View(short id,String username,String nickname,String role){}
 record Input(@Size(min=1,max=40) String nickname,
              @Pattern(regexp="[a-zA-Z0-9_]{3,40}") String username,
              @Size(max=200) String oldPassword,@Size(max=200) String newPassword){}
 record Result(View profile,boolean loginRequired){}
 ProfileService(AccountRepository accounts,PasswordEncoder passwords,JdbcTemplate db,ActivityService activity){this.accounts=accounts;this.passwords=passwords;this.db=db;this.activity=activity;}
 static View view(Account a){return new View(a.id,a.username,a.nickname,a.role);}
 View get(String username){return view(accounts.findByUsername(username).orElseThrow(()->new ResponseStatusException(HttpStatus.UNAUTHORIZED,"请重新登录")));}
 @Transactional
 public Result update(String current,Input input){
  Account a=accounts.findForUpdate(current).orElseThrow(()->new ResponseStatusException(HttpStatus.UNAUTHORIZED,"请重新登录"));
  String nickname=input.nickname()==null?a.nickname:input.nickname().trim();
  String username=input.username()==null?a.username:input.username();
  if(nickname.isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"昵称不能为空");
  boolean rename=!username.equals(a.username), changePassword=input.newPassword()!=null&&!input.newPassword().isEmpty();
  if(changePassword&&input.newPassword().length()<8)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"新密码至少需要 8 位");
  if(rename||changePassword){
   long now=System.currentTimeMillis();Attempts previous=attempts.get(a.id);
   if(previous!=null&&now-previous.since()<900000&&previous.count()>=10)throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"旧密码尝试次数较多，请 15 分钟后重试");
   if(input.oldPassword()==null||input.oldPassword().isEmpty())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"修改用户名或密码时，请输入旧密码");
   if(!passwords.matches(input.oldPassword(),a.password)){
    attempts.compute(a.id,(id,old)->old==null||now-old.since()>=900000?new Attempts(1,now):new Attempts(old.count()+1,old.since()));
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"旧密码不正确");
   }
   attempts.remove(a.id);
  }
  if(rename&&accounts.findByUsername(username).isPresent())throw new ResponseStatusException(HttpStatus.CONFLICT,"这个用户名已被使用，请换一个");
  boolean nicknameChanged=!nickname.equals(a.nickname);
  a.nickname=nickname;a.username=username;
  if(changePassword)a.password=passwords.encode(input.newPassword());
  try { accounts.saveAndFlush(a); } catch(org.springframework.dao.DataIntegrityViolationException e) { throw new ResponseStatusException(HttpStatus.CONFLICT,"这个用户名已被使用，请换一个"); }
  if(rename){
   db.update("UPDATE memories SET author=? WHERE author=?",username,current);
   db.update("UPDATE site_settings SET updated_by=? WHERE updated_by=?",username,current);
   db.update("UPDATE audit_log SET actor=? WHERE actor=?",username,current);
  }
  if(nicknameChanged)activity.record("accounts",Short.toString(a.id),"updated",nickname,"更新了昵称","/admin");
  // The rename's actor is the old authenticated principal until this request ends.
  if(rename)db.update("UPDATE activity_events SET actor=? WHERE actor=?",username,current);
  if(rename||changePassword)db.update("DELETE FROM spring_session WHERE principal_name=?",current);
  return new Result(view(a),rename||changePassword);
 }
}
