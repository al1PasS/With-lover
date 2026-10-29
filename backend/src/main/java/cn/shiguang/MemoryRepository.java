package cn.shiguang;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.*;
import java.util.UUID;
interface MemoryRepository extends JpaRepository<Memory,UUID>{
 Page<Memory> findByDeletedAtIsNullOrderByDateDesc(Pageable p);
 Page<Memory> findByPublishedTrueAndPublicVisibleTrueAndDeletedAtIsNullOrderByDateDesc(Pageable p);
 Page<Memory> findByDeletedAtIsNotNullOrderByDeletedAtDesc(Pageable p);
}
