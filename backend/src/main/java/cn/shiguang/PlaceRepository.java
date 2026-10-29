package cn.shiguang;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
interface PlaceRepository extends JpaRepository<Place,UUID>{List<Place> findAllByOrderBySortOrderAscCreatedAtDesc();}
