package cn.shiguang;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
interface AccountRepository extends JpaRepository<Account,Short>{Optional<Account> findByUsername(String username);}
