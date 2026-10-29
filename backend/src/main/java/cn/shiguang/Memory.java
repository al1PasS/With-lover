package cn.shiguang;
import jakarta.persistence.*;
import java.time.*;
import java.util.UUID;
@Entity @Table(name="memories")
class Memory {
 @Id UUID id=UUID.randomUUID();
 @Version long version;
 @Column(nullable=false) String title;
 @Column(nullable=false,columnDefinition="text") String body;
 @Column(nullable=false) LocalDate date;
 @Column(nullable=false) String city="";
 @Column(nullable=false) String tag="烟火日常";
 @Column(nullable=false,columnDefinition="text") String image="";
 boolean published=false;
 boolean publicVisible=false;
 @Column(nullable=false,length=500) String publicSummary="";
 String author;
 Instant deletedAt;
 Instant updatedAt=Instant.now();
 protected Memory(){}
}
