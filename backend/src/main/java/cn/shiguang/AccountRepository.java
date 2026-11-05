package cn.shiguang;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
interface AccountRepository extends JpaRepository<Account,Short>{Optional<Account> findByUsername(String username);
 @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
 @org.springframework.data.jpa.repository.Query("select a from Account a where a.username = :username")
 Optional<Account> findForUpdate(@org.springframework.data.repository.query.Param("username") String username);
}
