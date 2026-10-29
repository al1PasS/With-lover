package cn.shiguang;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication
public class Application { public static void main(String[] args){var context=SpringApplication.run(Application.class,args);if(java.util.Arrays.stream(context.getEnvironment().getActiveProfiles()).anyMatch("init-accounts"::equals))context.close();} }
