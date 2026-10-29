package cn.shiguang;
import org.springframework.boot.*;import org.springframework.context.annotation.Profile;import org.springframework.stereotype.Component;import org.springframework.security.crypto.password.PasswordEncoder;import org.springframework.transaction.annotation.Transactional;import java.io.Console;import java.util.Arrays;
@Component @Profile("init-accounts")
class InitializeAccounts implements CommandLineRunner {
 private final AccountRepository accounts;private final PasswordEncoder encoder;
 InitializeAccounts(AccountRepository accounts,PasswordEncoder encoder){this.accounts=accounts;this.encoder=encoder;}
 @Override @Transactional public void run(String... args){Console console=System.console();if(console==null)throw new IllegalStateException("请使用交互式终端运行账户初始化");if(accounts.count()!=0)throw new IllegalStateException("账户已存在，不覆盖既有账户");
  for(short i=1;i<=2;i++){Account a=new Account();a.id=i;a.username=console.readLine("账户 %d 用户名：",i);a.nickname=console.readLine("昵称：");if(a.username==null||!a.username.matches("[a-zA-Z0-9_]{3,40}"))throw new IllegalArgumentException("用户名需为3至40位字母、数字或下划线");char[] password=console.readPassword("密码（至少8位）：");if(password==null||password.length<8)throw new IllegalArgumentException("密码至少8位");try{a.password=encoder.encode(new String(password));}finally{Arrays.fill(password,'\0');}a.role=i==1?"ADMIN":"MEMBER";accounts.save(a);}accounts.flush();console.printf("两个账户已初始化。\n");
 }
}
