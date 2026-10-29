package cn.shiguang;
import org.springframework.data.jpa.repository.JpaRepository;import java.util.*;
interface AnniversaryRepository extends JpaRepository<Anniversary,UUID>{
 List<Anniversary> findAllByOrderByPositionAsc();
 List<Anniversary> findByPublicVisibleTrueOrderByPositionAsc();
 Optional<Anniversary> findTopByOrderByPositionDesc();
}
