package cn.shiguang;
import jakarta.persistence.*;import java.time.LocalDate;import java.util.UUID;
@Entity @Table(name="anniversaries")
class Anniversary {
 @Id UUID id=UUID.randomUUID();
 String title;
 LocalDate date;
 boolean annual;
 Short lunarMonth;
 Short lunarDay;
 int position;
 boolean publicVisible=false;
 protected Anniversary(){}
}
